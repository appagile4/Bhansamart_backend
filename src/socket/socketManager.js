import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";

let io = null;

/**
 * Initialize Socket.IO with HTTP Server
 */
export const initSocket = (httpServer) => {
  const allowedOrigins = [
    process.env.CLIENT_URL,
    "http://localhost:3000",
    "http://localhost:8081",
    "http://localhost:19006",
    "http://192.168.29.235:8081",
    "http://192.168.29.235:19006",
    "http://192.168.29.235:3000",
    "http://192.168.29.235:5000",
  ].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (
          allowedOrigins.indexOf(origin) !== -1 ||
          process.env.NODE_ENV === "development"
        ) {
          return callback(null, true);
        }
        return callback(new Error("Socket CORS rejected"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── 1. Authentication Middleware for Sockets ──────────────────────────
  io.use(async (socket, next) => {
    try {
      const authHeader =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      let token = authHeader;
      if (token && token.startsWith("Bearer ")) {
        token = token.slice(7).trim();
      }

      if (!token) {
        return next(new Error("Authentication token required for Socket connection"));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "default_jwt_secret_change_in_production"
      );

      const user = await User.findById(decoded.userId).select("+role +isActive");
      if (!user || !user.isActive) {
        return next(new Error("User account is invalid or deactivated"));
      }

      socket.user = user;
      socket.userId = user._id.toString();
      socket.role = user.role;

      // Lookup vendor record if exists for this user
      const vendor = await Vendor.findOne({ userId: user._id });
      if (vendor) {
        socket.vendorId = vendor._id.toString();
      }

      // Lookup delivery profile if exists for this user
      const deliveryBoy = await DeliveryBoy.findOne({ user: user._id });
      if (deliveryBoy) {
        socket.deliveryBoyId = deliveryBoy._id.toString();
      }

      next();
    } catch (err) {
      console.warn("[Socket Auth Error]:", err.message);
      return next(new Error("Invalid or expired authentication token"));
    }
  });

  // ── 2. Socket Connection & Room Routing ──────────────────────────────
  io.on("connection", (socket) => {
    console.log(
      `[Socket Connected] Socket ID: ${socket.id} | User: ${socket.user?.name} (${socket.userId}) | Role: ${socket.role}`
    );

    // Auto-join personal user room for targeted customer notifications
    const userRoom = `user:${socket.userId}`;
    socket.join(userRoom);

    // Auto-join vendor store room if authorized vendor
    if (socket.vendorId) {
      const storeRoom = `store:${socket.vendorId}`;
      const vendorRoom = `vendor:${socket.vendorId}`;
      socket.join(storeRoom);
      socket.join(vendorRoom);
      console.log(`[Socket] Vendor ${socket.vendorId} joined room ${storeRoom}`);
    }

    // Auto-join delivery room if authorized delivery partner
    if (socket.deliveryBoyId) {
      const deliveryRoom = `delivery:${socket.deliveryBoyId}`;
      socket.join(deliveryRoom);
      console.log(`[Socket] Delivery Partner ${socket.deliveryBoyId} joined room ${deliveryRoom}`);
    }

    // ── 3. Client Event: Subscribe to Order Tracking Room ───────────────
    socket.on("customer:order:subscribe", async (data, ack) => {
      try {
        const orderId = String(data?.orderId || "").trim();
        if (!orderId) {
          if (typeof ack === "function") ack({ success: false, message: "Order ID is required" });
          return;
        }

        // Validate customer ownership or vendor store ownership
        const order = await Order.findById(orderId).select("customer vendor assignedDeliveryBoy");
        if (!order) {
          if (typeof ack === "function") ack({ success: false, message: "Order not found" });
          return;
        }

        const isCustomerOwner = order.customer && order.customer.toString() === socket.userId;
        const isVendorOwner =
          (socket.vendorId && order.vendor && order.vendor.toString() === socket.vendorId) ||
          socket.user?.role === "vendor" ||
          socket.role === "vendor" ||
          Boolean(socket.vendorId);
        const isDeliveryOwner =
          socket.deliveryBoyId &&
          order.assignedDeliveryBoy &&
          order.assignedDeliveryBoy.toString() === socket.deliveryBoyId;
        const isAdmin = socket.role === "admin" || socket.role === "superadmin";

        if (!isCustomerOwner && !isVendorOwner && !isDeliveryOwner && !isAdmin) {
          if (typeof ack === "function")
            ack({ success: false, message: "Unauthorized access to this order room" });
          return;
        }

        const orderRoom = `order:${orderId}`;
        socket.join(orderRoom);
        console.log(`[Socket] User ${socket.userId} joined order room: ${orderRoom}`);

        if (typeof ack === "function") {
          ack({ success: true, room: orderRoom });
        }
      } catch (err) {
        console.error("[customer:order:subscribe error]:", err);
        if (typeof ack === "function") ack({ success: false, message: "Subscription error" });
      }
    });

    // ── 4. Client Event: Vendor Subscribes to Store Room ────────────────
    socket.on("vendor:orders:subscribe", (data, ack) => {
      try {
        const storeId = String(data?.storeId || socket.vendorId || "").trim();
        if (!socket.vendorId || socket.vendorId !== storeId) {
          if (typeof ack === "function")
            ack({ success: false, message: "Unauthorized: not your store" });
          return;
        }

        const room = `store:${storeId}`;
        socket.join(room);
        console.log(`[Socket] Vendor ${socket.vendorId} subscribed to ${room}`);
        if (typeof ack === "function") ack({ success: true, room });
      } catch (err) {
        if (typeof ack === "function") ack({ success: false, message: err.message });
      }
    });

    // ── 5. Client Event: Vendor Accepts Order via Socket ────────────────
    socket.on("vendor:order:accept", async (data, ack) => {
      try {
        const orderId = String(data?.orderId || "").trim();
        if (!orderId || !socket.vendorId) {
          if (typeof ack === "function")
            ack({ success: false, message: "Missing order ID or vendor unauthorized" });
          return;
        }

        const order = await Order.findOneAndUpdate(
          {
            _id: orderId,
            vendor: socket.vendorId,
            orderStatus: "PLACED",
          },
          {
            $set: {
              orderStatus: "ACCEPTED",
              acceptedAt: new Date(),
            },
            $push: {
              statusHistory: {
                status: "ACCEPTED",
                timestamp: new Date(),
                updatedBy: socket.user._id,
                reason: "Accepted by vendor",
              },
            },
          },
          { returnDocument: "after" }
        )
          .populate("vendor", "businessDetails sellerDetails")
          .populate("customer", "name phone email");

        if (!order) {
          if (typeof ack === "function")
            ack({
              success: false,
              message: "Order cannot be accepted (it may already be processed or belongs to another store).",
            });
          return;
        }

        // Notify customer in real-time
        emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);

        // Automatically dispatch to nearest available delivery partner
        import("../utils/dispatchEngine.js")
          .then(({ dispatchOrderToNearestPartner }) => {
            dispatchOrderToNearestPartner(order._id).catch((err) => {
              console.warn("[Auto-dispatch from socket error]:", err.message);
            });
          })
          .catch(() => {});

        // Acknowledge back to vendor
        if (typeof ack === "function") {
          ack({ success: true, order });
        }
      } catch (err) {
        console.error("[vendor:order:accept error]:", err);
        if (typeof ack === "function")
          ack({ success: false, message: err.message || "Failed to accept order" });
      }
    });

    // ── 6. Client Event: Vendor Rejects Order via Socket ────────────────
    socket.on("vendor:order:reject", async (data, ack) => {
      try {
        const orderId = String(data?.orderId || "").trim();
        const reason = String(data?.reason || "Item unavailable / Kitchen busy").trim();

        if (!orderId || !socket.vendorId) {
          if (typeof ack === "function")
            ack({ success: false, message: "Missing order ID or vendor unauthorized" });
          return;
        }

        const order = await Order.findOneAndUpdate(
          {
            _id: orderId,
            vendor: socket.vendorId,
            orderStatus: "PLACED",
          },
          {
            $set: {
              orderStatus: "REJECTED",
              rejectionReason: reason,
            },
            $push: {
              statusHistory: {
                status: "REJECTED",
                timestamp: new Date(),
                updatedBy: socket.user._id,
                reason,
              },
            },
          },
          { returnDocument: "after" }
        )
          .populate("vendor", "businessDetails sellerDetails")
          .populate("customer", "name phone email");

        if (!order) {
          if (typeof ack === "function")
            ack({
              success: false,
              message: "Order cannot be rejected (it may already be processed).",
            });
          return;
        }

        // Notify customer in real-time
        emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);

        if (typeof ack === "function") {
          ack({ success: true, order });
        }
      } catch (err) {
        console.error("[vendor:order:reject error]:", err);
        if (typeof ack === "function")
          ack({ success: false, message: err.message || "Failed to reject order" });
      }
    });

    // ── 7. Client Event: Delivery Partner GPS Location Update ───────────
    socket.on("delivery:location:update", async (data, ack) => {
      try {
        if (!socket.deliveryBoyId) {
          if (typeof ack === "function")
            ack({ success: false, message: "Unauthorized delivery partner" });
          return;
        }

        const lat = parseFloat(data?.latitude);
        const lng = parseFloat(data?.longitude);
        if (isNaN(lat) || isNaN(lng)) {
          if (typeof ack === "function")
            ack({ success: false, message: "Invalid latitude or longitude coordinates" });
          return;
        }

        const now = new Date();

        // 1. Update delivery partner's current location in database
        const partner = await DeliveryBoy.findByIdAndUpdate(
          socket.deliveryBoyId,
          {
            $set: {
              currentLocation: {
                type: "Point",
                coordinates: [lng, lat],
              },
              lastLocationUpdatedAt: now,
            },
          },
          { new: true }
        );

        // 2. If partner is actively fulfilling an order, sync coordinates and broadcast
        if (partner?.activeOrderId) {
          await Order.findByIdAndUpdate(partner.activeOrderId, {
            $set: {
              deliveryBoyLocation: {
                type: "Point",
                coordinates: [lng, lat],
                updatedAt: now,
              },
            },
          });

          // Broadcast to customer and vendor tracking this order room
          const locPayload = {
            orderId: partner.activeOrderId,
            deliveryBoyId: socket.deliveryBoyId,
            latitude: lat,
            longitude: lng,
            heading: data.heading || 0,
            speed: data.speed || 0,
            updatedAt: now,
          };

          io.to(`order:${partner.activeOrderId}`).emit(
            "delivery:location:update",
            locPayload
          );
        }

        if (typeof ack === "function") {
          ack({ success: true, timestamp: now });
        }
      } catch (err) {
        console.error("[delivery:location:update error]:", err);
        if (typeof ack === "function") ack({ success: false, message: err.message });
      }
    });

    // ── 8. Client Event: Delivery Partner Subscribes to Order Room ──────
    socket.on("delivery:order:subscribe", async (data, ack) => {
      try {
        const orderId = String(data?.orderId || "").trim();
        if (!orderId || !socket.deliveryBoyId) {
          if (typeof ack === "function")
            ack({ success: false, message: "Missing order ID or unauthorized" });
          return;
        }

        const order = await Order.findById(orderId).select("assignedDeliveryBoy");
        if (
          !order ||
          (order.assignedDeliveryBoy &&
            order.assignedDeliveryBoy.toString() !== socket.deliveryBoyId)
        ) {
          if (typeof ack === "function")
            ack({ success: false, message: "Not assigned to this order" });
          return;
        }

        const room = `order:${orderId}`;
        socket.join(room);
        console.log(`[Socket] Delivery Partner ${socket.deliveryBoyId} subscribed to ${room}`);
        if (typeof ack === "function") ack({ success: true, room });
      } catch (err) {
        if (typeof ack === "function") ack({ success: false, message: err.message });
      }
    });

    // ── 9. Client Event: Customer Location Update & Proximity Discovery ──
    let lastCustomerLocationUpdate = 0;
    socket.on("customer:location:update", async (data, ack) => {
      try {
        const now = Date.now();
        // Throttle updates: max 1 per 2 seconds
        if (now - lastCustomerLocationUpdate < 2000) {
          if (typeof ack === "function") ack({ success: true, throttled: true });
          return;
        }
        lastCustomerLocationUpdate = now;

        const lat = parseFloat(data?.latitude);
        const lng = parseFloat(data?.longitude);
        if (isNaN(lat) || isNaN(lng)) {
          if (typeof ack === "function") ack({ success: false, message: "Invalid coordinates" });
          return;
        }

        // Query active, open vendors where distance <= vendor.deliveryRadiusKm
        let eligibleVendors = [];
        try {
          eligibleVendors = await Vendor.aggregate([
            {
              $geoNear: {
                near: { type: "Point", coordinates: [lng, lat] },
                distanceField: "distanceMeters",
                spherical: true,
                query: {
                  status: { $in: ["approved", "active"] },
                  isStoreOpen: { $ne: false },
                },
              },
            },
            {
              $match: {
                $expr: {
                  $lte: [
                    "$distanceMeters",
                    { $multiply: [{ $ifNull: ["$deliveryRadiusKm", 5] }, 1000] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                businessDetails: 1,
                sellerDetails: 1,
                shippingLocations: 1,
                deliveryRadiusKm: 1,
                isStoreOpen: 1,
                distanceMeters: 1,
                distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 1] },
              },
            },
          ]);
        } catch (geoErr) {
          const vendors = await Vendor.find({
            status: { $in: ["approved", "active"] },
            isStoreOpen: { $ne: false },
          }).lean();
          const { calculateDistanceKm } = await import("../utils/dispatchEngine.js");
          eligibleVendors = vendors
            .map((v) => {
              const vLng = v.shippingLocations?.longitude || v.location?.coordinates?.[0] || 85.324;
              const vLat = v.shippingLocations?.latitude || v.location?.coordinates?.[1] || 27.7172;
              const dist = calculateDistanceKm(lat, lng, vLat, vLng);
              const radius = v.deliveryRadiusKm || 5;
              return { ...v, distanceKm: dist, isEligible: dist <= radius };
            })
            .filter((v) => v.isEligible);
        }

        const payload = {
          count: eligibleVendors.length,
          vendors: eligibleVendors.map((v) => ({
            id: v._id,
            name: v.businessDetails?.businessName || v.sellerDetails?.sellerName || "Store",
            distanceKm: v.distanceKm,
            deliveryRadiusKm: v.deliveryRadiusKm || 5,
          })),
          coordinates: { latitude: lat, longitude: lng },
          timestamp: new Date(),
        };

        socket.emit("customer:nearby-vendors:update", payload);
        if (typeof ack === "function") ack({ success: true, ...payload });
      } catch (err) {
        console.error("[customer:location:update error]:", err);
        if (typeof ack === "function") ack({ success: false, message: err.message });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket Disconnected] ${socket.id} (Reason: ${reason})`);
    });
  });

  return io;
};

/**
 * Accessor for active Socket.IO server instance
 */
export const getIO = () => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized yet!");
  }
  return io;
};

/**
 * Real-time notification helper: Emit new order to authorized vendor room
 */
export const emitNewOrderToVendor = (vendorId, order) => {
  if (!io) return;
  const storeRoom = `store:${vendorId}`;

  // Sanitize order payload for vendor privacy & fulfillment
  const vendorPayload = {
    _id: order._id,
    orderNumber: order.orderNumber,
    customerName: order.customer?.name || "Customer",
    customerPhone: order.customer?.phone || order.deliveryAddress?.phone || "",
    items: order.items.map((item) => ({
      _id: item._id,
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      weight: item.weight,
    })),
    totalCount: order.totalCount,
    itemsTotal: order.itemsTotal,
    handlingCharge: order.handlingCharge,
    deliveryCharge: order.deliveryCharge,
    discount: order.discount,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    deliveryAddress: {
      addressLine: order.deliveryAddress?.addressLine || "",
      city: order.deliveryAddress?.city || "",
      street: order.deliveryAddress?.street || "",
      houseNo: order.deliveryAddress?.houseNo || "",
      landmark: order.deliveryAddress?.landmark || "",
      phone: order.deliveryAddress?.phone || "",
      type: order.deliveryAddress?.type || "Home",
    },
    createdAt: order.createdAt,
    time: new Date(order.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  io.to(storeRoom).emit("vendor:order:new", vendorPayload);
  console.log(`[Socket Emitted] vendor:order:new sent to room: ${storeRoom} for Order: ${order.orderNumber}`);
};

/**
 * Real-time notification helper: Emit order status change to customer and vendor rooms
 */
export const emitOrderStatusUpdate = (orderId, customerId, order) => {
  if (!io) return;

  const updatePayload = {
    _id: order._id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    rejectionReason: order.rejectionReason,
    statusHistory: order.statusHistory,
    totalAmount: order.totalAmount,
    paymentStatus: order.paymentStatus,
    deliveredAt: order.deliveredAt,
    acceptedAt: order.acceptedAt,
    updatedAt: order.updatedAt || new Date(),
  };

  // 1. Emit to order specific room (customer order details screen)
  io.to(`order:${orderId}`).emit("customer:order:status_updated", updatePayload);

  // 2. Emit to customer's personal room (customer home/orders list)
  if (customerId) {
    io.to(`user:${customerId}`).emit("customer:order:status_updated", updatePayload);
  }

  // 3. Emit to vendor's store room
  if (order.vendor) {
    const vId = order.vendor._id ? order.vendor._id.toString() : order.vendor.toString();
    io.to(`store:${vId}`).emit("vendor:order:status_updated", updatePayload);
  }

  console.log(
    `[Socket Emitted] customer:order:status_updated for Order ${order.orderNumber} -> Status: ${order.orderStatus}`
  );
};

/**
 * Real-time notification helper: Emit event to a specific delivery partner room
 */
export const emitToDeliveryPartner = (deliveryBoyId, event, data) => {
  if (!io || !deliveryBoyId) return;
  const room = `delivery:${deliveryBoyId}`;
  io.to(room).emit(event, data);
  console.log(`[Socket Emitted] ${event} sent to ${room}`);
};

/**
 * Real-time notification helper: Emit event to order tracking room
 */
export const emitToOrderRoom = (orderId, event, data) => {
  if (!io || !orderId) return;
  const room = `order:${orderId}`;
  io.to(room).emit(event, data);
  console.log(`[Socket Emitted] ${event} sent to ${room}`);
};

/**
 * Real-time notification helper: Emit live GPS update for an order
 */
export const emitDeliveryLocationUpdate = (orderId, locationData) => {
  if (!io || !orderId) return;
  const room = `order:${orderId}`;
  io.to(room).emit("delivery:location:update", locationData);
};

/**
 * Real-time notification helper: Emit persistent notification to vendor
 */
export const emitVendorNotification = (vendorId, notification) => {
  if (!io || !vendorId) return;
  const vId = vendorId.toString();
  io.to(`store:${vId}`).emit("vendor:notification", notification);
  io.to(`vendor:${vId}`).emit("vendor:notification", notification);
  console.log(`[Socket Emitted] vendor:notification sent to store:${vId}`);
};

/**
 * Real-time notification helper: Emit COD custody update to vendor
 */
export const emitVendorCodUpdate = (vendorId, codData) => {
  if (!io || !vendorId) return;
  const vId = vendorId.toString();
  io.to(`store:${vId}`).emit("vendor:cod:update", codData);
  io.to(`vendor:${vId}`).emit("vendor:cod:update", codData);
  console.log(`[Socket Emitted] vendor:cod:update sent to store:${vId}`);
};

/**
 * Real-time notification helper: Emit wallet balance update to vendor
 */
export const emitVendorWalletUpdate = (vendorId, walletData) => {
  if (!io || !vendorId) return;
  const vId = vendorId.toString();
  io.to(`store:${vId}`).emit("vendor:wallet:update", walletData);
  io.to(`vendor:${vId}`).emit("vendor:wallet:update", walletData);
  console.log(`[Socket Emitted] vendor:wallet:update sent to store:${vId}`);
};

/**
 * Real-time notification helper: Broadcast vendor delivery radius update to all active customers
 */
export const emitDeliveryRadiusUpdated = (vendorId, deliveryRadiusKm, storeName = "") => {
  if (!io || !vendorId) return;
  const payload = {
    vendorId: vendorId.toString(),
    deliveryRadiusKm,
    storeName,
    updatedAt: new Date(),
  };
  io.emit("vendor:delivery-radius:updated", payload);
  console.log(`[Socket Emitted] vendor:delivery-radius:updated for vendor ${vendorId}: ${deliveryRadiusKm}km`);
};

/**
 * Real-time notification helper: Broadcast vendor store open/close availability
 */
export const emitVendorAvailabilityChanged = (vendorId, isStoreOpen, storeName = "") => {
  if (!io || !vendorId) return;
  const payload = {
    vendorId: vendorId.toString(),
    isStoreOpen,
    storeName,
    updatedAt: new Date(),
  };
  io.emit("vendor:availability:changed", payload);
  console.log(`[Socket Emitted] vendor:availability:changed for vendor ${vendorId}: isStoreOpen=${isStoreOpen}`);
};

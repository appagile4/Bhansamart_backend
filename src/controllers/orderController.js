import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import Cart from "../models/Cart.js";
import Address from "../models/Address.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import VendorNotification from "../models/VendorNotification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  emitNewOrderToVendor,
  emitOrderStatusUpdate,
  emitVendorNotification,
} from "../socket/socketManager.js";
import { dispatchOrderToNearestPartner } from "../utils/dispatchEngine.js";

/**
 * Helper to resolve Vendor for logged-in vendor user
 */
const resolveVendor = async (user) => {
  let vendor = await Vendor.findOne({ userId: user._id || user.id });
  return vendor;
};

/**
 * @desc    Place a new customer order
 * @route   POST /api/orders
 * @access  Private (Customer)
 */
export const createOrder = async (req, res, next) => {
  try {
    const customerId = req.user._id;
    const {
      items,
      deliveryAddress,
      addressId,
      paymentMethod = "Cash on delivery",
      couponCode,
      idempotencyKey,
    } = req.body;

    // ── 1. Idempotency Check (Prevent duplicate orders on repeated clicks/network retry) ──
    if (idempotencyKey) {
      const existingOrder = await Order.findOne({
        idempotencyKey,
        customer: customerId,
      })
        .populate("vendor", "businessDetails sellerDetails brandDetails shippingLocations")
        .populate("customer", "name email phone");

      if (existingOrder) {
        return res.status(200).json({
          success: true,
          message: "Order already confirmed (idempotent response).",
          data: existingOrder,
        });
      }
    }

    // ── 2. Validate Items Array ──────────────────────────────────────────
    if (!items || !Array.isArray(items) || items.length === 0) {
      return next(new AppError("Order must contain at least one item", 400));
    }

    // ── 3. Resolve Delivery Address ─────────────────────────────────────
    let resolvedAddress = deliveryAddress;

    if (!resolvedAddress && addressId) {
      const savedAddress = await Address.findOne({
        _id: addressId,
        user: customerId,
      });
      if (savedAddress) {
        resolvedAddress = {
          addressLine: savedAddress.addressLine,
          city: savedAddress.city || "Kathmandu",
          street: savedAddress.street || "",
          houseNo: savedAddress.houseNo || "",
          landmark: savedAddress.landmark || "",
          phone: savedAddress.phone,
          type: savedAddress.type || "Home",
        };
      }
    }

    if (!resolvedAddress || !resolvedAddress.addressLine || !resolvedAddress.phone) {
      return next(
        new AppError(
          "Valid delivery address with contact phone number is required",
          400
        )
      );
    }

    // ── 4. Verify Products, Vendor & Real-time Stock in Database ─────────
    const productIds = items.map((it) => it.productId || it.id || it._id);

    const dbProducts = await Product.find({
      _id: { $in: productIds },
      isDeleted: false,
    });

    if (dbProducts.length !== items.length) {
      return next(
        new AppError(
          "Some products in your cart are no longer available. Please refresh your cart.",
          400
        )
      );
    }

    // Single-store enforcement: verify all products belong to the exact same vendor
    const primaryVendorId = dbProducts[0].vendor.toString();
    const isSingleStore = dbProducts.every(
      (p) => p.vendor.toString() === primaryVendorId
    );

    if (!isSingleStore) {
      return next(
        new AppError(
          "All items in an order must come from the same store. Please place separate orders.",
          400
        )
      );
    }

    // Verify vendor is active & eligible
    const vendor = await Vendor.findById(primaryVendorId);
    if (!vendor || !["approved", "active"].includes(vendor.status)) {
      return next(
        new AppError("The selected store is currently not taking orders.", 400)
      );
    }

    // Check stock & build authoritative order item records (Server-side price truth!)
    const validatedOrderItems = [];
    let itemsTotal = 0;
    let totalCount = 0;

    for (const clientItem of items) {
      const prodId = String(clientItem.productId || clientItem.id || clientItem._id);
      const dbProd = dbProducts.find((p) => p._id.toString() === prodId);

      if (!dbProd) {
        return next(new AppError(`Product not found: ${prodId}`, 400));
      }

      const qty = Math.max(1, Number(clientItem.quantity) || 1);

      // Stock validation
      if (!dbProd.inStock || dbProd.stock < qty) {
        return next(
          new AppError(
            `"${dbProd.name}" only has ${dbProd.stock} unit(s) left in stock. Please adjust your quantity.`,
            400
          )
        );
      }

      const verifiedPrice = Number(dbProd.price) || 0;
      const verifiedOriginalPrice =
        Number(dbProd.originalPrice) || verifiedPrice;

      let imageUrl = "";
      if (dbProd.images && dbProd.images.length > 0) {
        imageUrl = dbProd.images[0].url;
      }

      validatedOrderItems.push({
        product: dbProd._id,
        productId: dbProd._id.toString(),
        name: dbProd.name,
        price: verifiedPrice,
        originalPrice: verifiedOriginalPrice,
        quantity: qty,
        imageUrl: imageUrl || clientItem.imageUrl || "",
        weight: dbProd.unit || clientItem.weight || "1 unit",
        category: dbProd.category || "",
      });

      itemsTotal += verifiedPrice * qty;
      totalCount += qty;
    }

    // ── 5. Server-Side Calculations ─────────────────────────────────────
    const handlingCharge = itemsTotal > 0 ? 30 : 0;
    const deliveryCharge = 0; // Free delivery promotion
    let discount = 0;

    // Optional simple coupon check
    if (couponCode === "FLAT50") {
      discount = Math.min(50, itemsTotal);
    }

    const totalAmount = Math.max(
      0,
      itemsTotal + handlingCharge + deliveryCharge - discount
    );

    // ── 6. Atomically Decrement Inventory ───────────────────────────────
    for (const item of validatedOrderItems) {
      await Product.findOneAndUpdate(
        {
          _id: item.product,
          stock: { $gte: item.quantity },
        },
        {
          $inc: { stock: -item.quantity, ordersCount: item.quantity },
        }
      );
    }

    // ── 7. Generate Human-Friendly Order Number ─────────────────────────
    const orderNumber = await Order.generateOrderNumber();

    // ── 8. Create Order in MongoDB ──────────────────────────────────────
    const newOrder = await Order.create({
      orderNumber,
      idempotencyKey: idempotencyKey || undefined,
      customer: customerId,
      vendor: vendor._id,
      items: validatedOrderItems,
      totalCount,
      itemsTotal,
      handlingCharge,
      deliveryCharge,
      discount,
      couponCode: couponCode || "",
      totalAmount,
      deliveryAddress: resolvedAddress,
      paymentMethod,
      paymentStatus: paymentMethod === "Cash on delivery" ? "pending" : "paid",
      orderStatus: "PLACED",
      statusHistory: [
        {
          status: "PLACED",
          timestamp: new Date(),
          updatedBy: customerId,
          reason: "Order placed by customer",
        },
      ],
      estimatedDeliveryTime: "15-25 mins",
    });

    // ── 9. Clear Customer's Server Cart ────────────────────────────────
    await Cart.findOneAndUpdate(
      { user: customerId },
      { $set: { items: [] } }
    ).catch(() => {});

    // Populate relations for response and real-time emission
    const populatedOrder = await Order.findById(newOrder._id)
      .populate("vendor", "businessDetails sellerDetails brandDetails shippingLocations")
      .populate("customer", "name email phone");

    // ── 10. Real-Time Socket.IO Notification to Authorized Vendor ───────
    emitNewOrderToVendor(vendor._id.toString(), populatedOrder);

    // Persistent vendor notification (available after restarting the app)
    const vendorNotif = await VendorNotification.create({
      vendor: vendor._id,
      order: newOrder._id,
      type: "NEW_ORDER",
      title: "New Customer Order!",
      message: `Order #${newOrder.orderNumber} received for NPR ${newOrder.totalAmount} (${newOrder.paymentMethod}).`,
      data: {
        orderNumber: newOrder.orderNumber,
        totalAmount: newOrder.totalAmount,
        customerName: populatedOrder.customer?.name || "Customer",
        itemsCount: newOrder.totalCount,
        paymentMethod: newOrder.paymentMethod,
      },
    });
    emitVendorNotification(vendor._id.toString(), vendorNotif);

    // Emit to customer's personal channel
    emitOrderStatusUpdate(
      populatedOrder._id.toString(),
      customerId.toString(),
      populatedOrder
    );

    return res.status(201).json({
      success: true,
      message: "Order placed successfully!",
      data: populatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get customer's order history
 * @route   GET /api/orders/my-orders
 * @access  Private (Customer)
 */
export const getMyOrders = async (req, res, next) => {
  try {
    const customerId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ customer: customerId })
        .populate("vendor", "businessDetails.businessName brandDetails.brandLogo sellerDetails.sellerName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments({ customer: customerId }),
    ]);

    return res.status(200).json({
      success: true,
      count: orders.length,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: page,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single order details by ID
 * @route   GET /api/orders/:id
 * @access  Private (Customer / Vendor / Admin)
 */
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id.toString();

    const query = id.match(/^[0-9a-fA-F]{24}$/)
      ? { _id: id }
      : { orderNumber: id.toUpperCase() };

    const order = await Order.findOne(query)
      .select("+pickupOtp.displayCode +deliveryOtp.displayCode")
      .populate("vendor", "businessDetails sellerDetails brandDetails shippingLocations")
      .populate("customer", "name email phone")
      .populate("assignedDeliveryBoy", "fullName phone vehicleDetails metrics currentLocation");

    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    // Authorization check: customer, vendor, or admin
    const isCustomer = order.customer._id.toString() === userId;
    let isVendor = false;
    const vendor = await resolveVendor(req.user);
    if (vendor && order.vendor._id.toString() === vendor._id.toString()) {
      isVendor = true;
    }
    const isAdmin = req.user.role === "admin" || req.user.role === "superadmin";

    if (!isCustomer && !isVendor && !isAdmin) {
      return next(
        new AppError("You do not have permission to view this order", 403)
      );
    }

    const orderData = order.toObject();

    // Security: Only share Pickup OTP with authorized Vendor, and Delivery OTP with Customer
    if (isVendor || isAdmin) {
      orderData.vendorPickupOtp = order.pickupOtp?.displayCode || null;
    } else {
      delete orderData.pickupOtp;
    }

    if (isCustomer || isAdmin) {
      orderData.customerDeliveryOtp = order.deliveryOtp?.displayCode || null;
    } else {
      delete orderData.deliveryOtp;
    }

    return res.status(200).json({
      success: true,
      data: orderData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get live & pending orders for the logged-in vendor
 * @route   GET /api/orders/vendor/live
 * @access  Private (Vendor)
 */
export const getVendorOrders = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);
    if (!vendor) {
      return next(new AppError("Vendor account not found for current user", 404));
    }

    const { status, page = 1, limit = 50 } = req.query;

    const query = { vendor: vendor._id };

    if (status && status !== "all" && status !== "All") {
      const s = String(status).toLowerCase();
      // Map frontend status labels if needed
      if (s === "new" || s === "pending") {
        query.orderStatus = "PLACED";
      } else if (s === "preparing") {
        query.orderStatus = { $in: ["ACCEPTED", "PREPARING"] };
      } else if (s === "ready") {
        query.orderStatus = "READY_FOR_PICKUP";
      } else if (s === "delivered" || s === "completed") {
        query.orderStatus = "DELIVERED";
      } else if (s === "cancelled" || s === "rejected") {
        query.orderStatus = { $in: ["CANCELLED", "REJECTED"] };
      } else {
        query.orderStatus = status;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total, pendingCount] = await Promise.all([
      Order.find(query)
        .select("+pickupOtp.displayCode")
        .populate("customer", "name phone email")
        .populate("assignedDeliveryBoy", "fullName phone vehicleDetails metrics currentLocation")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(query),
      Order.countDocuments({ vendor: vendor._id, orderStatus: "PLACED" }),
    ]);

    // Check active delivery assignments for orders that are currently being offered/accepted
    const orderIds = orders.map((o) => o._id);
    const activeAssignments = await DeliveryAssignment.find({
      order: { $in: orderIds },
      status: { $in: ["OFFERED", "ACCEPTED"] },
    })
      .populate("deliveryBoy", "fullName phone vehicleDetails metrics currentLocation")
      .lean();

    const assignmentMap = new Map();
    activeAssignments.forEach((a) => {
      assignmentMap.set(a.order.toString(), a);
    });

    const formattedOrders = orders.map((o) => {
      let rider = o.assignedDeliveryBoy || null;
      let assignment = assignmentMap.get(o._id.toString()) || null;

      if (!rider && assignment && assignment.deliveryBoy) {
        rider = assignment.deliveryBoy;
      }

      return {
        ...o,
        assignedDeliveryBoy: rider,
        assignmentStatus: assignment ? assignment.status : rider ? "ASSIGNED" : null,
        vendorPickupOtp: o.pickupOtp?.displayCode || null,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedOrders.length,
      total,
      pendingCount,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: formattedOrders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Vendor Updates Order Status (Atomic Transition)
 * @route   PATCH /api/orders/:id/status
 * @access  Private (Vendor / Admin)
 */
export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    let { status, reason = "" } = req.body;

    const vendor = await resolveVendor(req.user);
    if (!vendor && req.user.role !== "admin") {
      return next(new AppError("Vendor profile not found", 403));
    }

    // Map common frontend statuses
    const statusMap = {
      New: "PLACED",
      Preparing: "PREPARING",
      Ready: "READY_FOR_PICKUP",
      Delivered: "DELIVERED",
      Cancelled: "CANCELLED",
      Rejected: "REJECTED",
    };
    if (statusMap[status]) {
      status = statusMap[status];
    }

    const allowedStatuses = [
      "ACCEPTED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
      "REJECTED",
    ];

    if (!allowedStatuses.includes(status)) {
      return next(
        new AppError(
          `Invalid status transition. Allowed statuses: ${allowedStatuses.join(", ")}`,
          400
        )
      );
    }

    // Query condition to ensure vendor owns the order
    const queryCondition = { _id: id };
    if (req.user.role !== "admin") {
      queryCondition.vendor = vendor._id;
    }

    // Valid state transitions to avoid double-actions
    if (status === "ACCEPTED" || status === "REJECTED") {
      queryCondition.orderStatus = "PLACED";
    }

    const updatePayload = {
      $set: {
        orderStatus: status,
      },
      $push: {
        statusHistory: {
          status,
          timestamp: new Date(),
          updatedBy: req.user._id,
          reason,
        },
      },
    };

    if (status === "ACCEPTED") {
      updatePayload.$set.acceptedAt = new Date();
    }
    if (status === "DELIVERED") {
      updatePayload.$set.deliveredAt = new Date();
      updatePayload.$set.paymentStatus = "paid";
    }
    if (status === "REJECTED") {
      updatePayload.$set.rejectionReason = reason || "Declined by vendor";
    }

    // Atomic update
    const updatedOrder = await Order.findOneAndUpdate(
      queryCondition,
      updatePayload,
      { returnDocument: "after" }
    )
      .populate("vendor", "businessDetails sellerDetails brandDetails shippingLocations")
      .populate("customer", "name phone email");

    if (!updatedOrder) {
      return next(
        new AppError(
          "Order not found, already processed, or you do not have permission to manage this order.",
          400
        )
      );
    }

    // If order is rejected or cancelled, restore stock
    if (status === "REJECTED" || status === "CANCELLED") {
      for (const item of updatedOrder.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity, ordersCount: -item.quantity },
        }).catch(() => {});
      }
    }

    // Real-Time Notification to Customer and Vendor Rooms
    emitOrderStatusUpdate(
      updatedOrder._id.toString(),
      updatedOrder.customer?._id?.toString(),
      updatedOrder
    );

    // Persistent vendor notification
    const vId = updatedOrder.vendor?._id || updatedOrder.vendor;
    if (vId) {
      const typeMap = {
        ACCEPTED: "ORDER_ACCEPTED",
        PREPARING: "ORDER_PREPARING",
        READY_FOR_PICKUP: "ORDER_PREPARING",
        CANCELLED: "ORDER_CANCELLED",
        REJECTED: "ORDER_CANCELLED",
      };
      const notifType = typeMap[status] || "SYSTEM";
      const vendorNotif = await VendorNotification.create({
        vendor: vId,
        order: updatedOrder._id,
        type: notifType,
        title: `Order #${updatedOrder.orderNumber} ${status}`,
        message: `Order status updated to ${status}.`,
        data: {
          orderNumber: updatedOrder.orderNumber,
          orderStatus: status,
        },
      });
      emitVendorNotification(vId.toString(), vendorNotif);
    }

    // If order is accepted or ready for pickup, automatically dispatch to nearest available delivery partner
    if (status === "ACCEPTED" || status === "READY_FOR_PICKUP") {
      dispatchOrderToNearestPartner(updatedOrder._id).catch((dispatchErr) => {
        console.warn("[Auto-dispatch error]:", dispatchErr.message);
      });
    }

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status}.`,
      data: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

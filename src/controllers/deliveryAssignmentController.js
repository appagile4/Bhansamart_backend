import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import VendorTransaction from "../models/VendorTransaction.js";
import VendorNotification from "../models/VendorNotification.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import Refund from "../models/Refund.js";
import { sendPushToUsers, sendPushToVendors } from "../services/pushNotificationService.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  recordCodDoorstepCollection,
  recordOnlineOrderPayment,
} from "../services/financeLedgerService.js";
import {
  verifyHashedOTP,
  dispatchOrderToNearestPartner,
  clearOrderDispatchTimer,
} from "../utils/dispatchEngine.js";
import { createDeliveryNotification } from "../services/deliveryNotificationService.js";
import {
  notifyCustomerOrderPickedUp,
  notifyCustomerOrderOutForDelivery,
  notifyCustomerOrderDelivered,
  notifyCustomerOrderCancelled,
} from "../services/customerNotificationService.js";
import {
  emitOrderStatusUpdate,
  emitToOrderRoom,
  emitToDeliveryPartner,
  emitVendorNotification,
  emitVendorCodUpdate,
  emitVendorWalletUpdate,
} from "../socket/socketManager.js";

/**
 * Get active assignment for the logged-in delivery partner
 * GET /api/delivery/assignments/active
 */
export const getActiveAssignment = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    if (!deliveryBoy.activeOrderId) {
      return res.status(200).json({
        success: true,
        hasActiveOrder: false,
        order: null,
      });
    }

    const order = await Order.findById(deliveryBoy.activeOrderId)
      .populate("vendor", "businessDetails sellerDetails shippingLocations paymentSettings")
      .populate("customer", "name phone email");

    if (!order) {
      deliveryBoy.activeOrderId = null;
      deliveryBoy.availability = "ONLINE";
      await deliveryBoy.save();

      return res.status(200).json({
        success: true,
        hasActiveOrder: false,
        order: null,
      });
    }

    res.status(200).json({
      success: true,
      hasActiveOrder: true,
      order: {
        _id: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        itemsCount: order.totalCount,
        items: order.items,
        vendor: {
          id: order.vendor?._id,
          name: order.vendor?.businessDetails?.businessName || "Vendor Store",
          phone: order.vendor?.sellerDetails?.sellerPhone || "",
          address:
            order.vendor?.shippingLocations?.warehouseAddress ||
            order.vendor?.sellerDetails?.address ||
            "",
          city: order.vendor?.shippingLocations?.city || "",
          paymentSettings: order.vendor?.paymentSettings || null,
        },
        deliveryAddress: order.deliveryAddress,
        customerName: order.customer?.name || "Customer",
        customerPhone: order.customer?.phone || order.deliveryAddress?.phone || "",
        arrivedAtStoreAt: order.arrivedAtStoreAt,
        pickedUpAt: order.pickedUpAt,
        arrivedAtCustomerAt: order.arrivedAtCustomerAt,
        estimatedEarnings: order.deliveryEarnings?.total || 60,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Accept offered delivery assignment (Atomic)
 * POST /api/delivery/assignments/:assignmentId/accept
 */
export const acceptAssignment = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    if (deliveryBoy.activeOrderId) {
      return next(new AppError("You already have an active order in progress", 400));
    }

    const { assignmentId } = req.params;

    // Atomic update on Assignment to prevent race condition
    const assignment = await DeliveryAssignment.findOneAndUpdate(
      {
        _id: assignmentId,
        deliveryBoy: deliveryBoy._id,
        status: "OFFERED",
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!assignment) {
      return next(
        new AppError(
          "Assignment offer has expired, already been accepted, or is invalid",
          400
        )
      );
    }

    // Atomic assignment on Order
    const order = await Order.findOneAndUpdate(
      {
        _id: assignment.order,
        assignedDeliveryBoy: null,
      },
      {
        $set: {
          assignedDeliveryBoy: deliveryBoy._id,
        },
        $push: {
          statusHistory: {
            status: "DELIVERY_ASSIGNED",
            timestamp: new Date(),
            updatedBy: req.user._id,
            reason: `Assigned to delivery partner ${deliveryBoy.fullName}`,
          },
        },
      },
      { returnDocument: "after" }
    ).populate("vendor customer");

    if (!order) {
      // Rollback assignment status if order was somehow taken
      assignment.status = "CANCELLED";
      await assignment.save();
      return next(new AppError("Order has already been assigned to another partner", 409));
    }

    // Cancel active dispatch timer
    clearOrderDispatchTimer(order._id);

    // Update attempt history in assignment
    if (assignment.attempts && assignment.attempts.length > 0) {
      const lastAttempt = assignment.attempts[assignment.attempts.length - 1];
      if (lastAttempt && lastAttempt.deliveryBoy?.toString() === deliveryBoy._id.toString()) {
        lastAttempt.status = "ACCEPTED";
        lastAttempt.respondedAt = new Date();
        await assignment.save();
      }
    }

    // Mark delivery partner as BUSY
    deliveryBoy.availability = "BUSY";
    deliveryBoy.activeOrderId = order._id;
    await deliveryBoy.save();

    // Persistent delivery confirmation notification
    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_assignment_confirmed",
      title: "Delivery Assignment Confirmed! 🛵",
      message: `Order #${order.orderNumber} is assigned to you. Proceed to store for pickup.`,
      data: {
        orderId: order._id.toString(),
        assignmentId: assignment._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
      },
      category: "delivery",
    });

    emitToDeliveryPartner(
      deliveryBoy._id.toString(),
      "delivery:assignment:confirmed",
      {
        assignmentId: assignment._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
      },
      req.user._id.toString()
    );

    // Broadcast update via socket
    emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
    emitToOrderRoom(order._id.toString(), "delivery:partner:assigned", {
      orderId: order._id,
      deliveryBoy: {
        _id: deliveryBoy._id,
        name: deliveryBoy.fullName,
        phone: deliveryBoy.phone,
        vehicleType: deliveryBoy.vehicleDetails?.vehicleType,
        rating: deliveryBoy.metrics?.rating,
      },
    });

    res.status(200).json({
      success: true,
      message: "Delivery assignment accepted successfully",
      assignment,
      orderId: order._id,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reject offered delivery assignment
 * POST /api/delivery/assignments/:assignmentId/reject
 */
export const rejectAssignment = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { assignmentId } = req.params;
    const { reason = "Partner rejected offer" } = req.body;

    const assignment = await DeliveryAssignment.findOneAndUpdate(
      {
        _id: assignmentId,
        deliveryBoy: deliveryBoy._id,
        status: "OFFERED",
      },
      {
        $set: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
        $push: {
          declinedRiders: deliveryBoy._id,
        },
      },
      { returnDocument: "after" }
    );

    if (!assignment) {
      return next(new AppError("Assignment not found or offer is no longer valid", 404));
    }

    clearOrderDispatchTimer(assignment.order);

    // Update attempts array
    await DeliveryAssignment.updateOne(
      { _id: assignment._id, "attempts.deliveryBoy": deliveryBoy._id, "attempts.status": "OFFERED" },
      { $set: { "attempts.$.status": "REJECTED", "attempts.$.respondedAt": new Date(), "attempts.$.reason": reason } }
    );

    console.log(
      `[Assignment] Partner ${deliveryBoy.fullName} rejected order ${assignment.order}. Re-dispatching to next candidate...`
    );

    // Asynchronously offer order to next nearest partner
    dispatchOrderToNearestPartner(assignment.order).catch((err) =>
      console.error("[Re-dispatch after reject error]:", err)
    );

    res.status(200).json({
      success: true,
      message: "Assignment rejected. Dispatch engine will route to another partner.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark Arrived at Vendor Store
 * POST /api/delivery/assignments/:orderId/arrived-store
 */
export const markArrivedAtStore = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { orderId } = req.params;
    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryBoy: deliveryBoy._id,
    }).populate("vendor customer");

    if (!order) {
      return next(new AppError("Order not found or not assigned to you", 404));
    }

    order.arrivedAtStoreAt = new Date();
    order.statusHistory.push({
      status: "ARRIVED_AT_STORE",
      timestamp: new Date(),
      updatedBy: req.user._id,
      reason: "Delivery partner has reached the vendor store",
    });
    await order.save();

    emitToOrderRoom(order._id.toString(), "delivery:arrived_store", {
      orderId: order._id,
      timestamp: order.arrivedAtStoreAt,
    });

    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_pickup_reminder",
      title: "Store Arrival Recorded 🏪",
      message: `You arrived at store. Request the 4-digit Pickup OTP from store counter for order #${order.orderNumber}.`,
      data: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
      },
      category: "delivery",
    });

    res.status(200).json({
      success: true,
      message: "Marked arrived at vendor store. Request the Pickup OTP from the store manager.",
      orderStatus: order.orderStatus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify Pickup OTP and Transition Order to OUT_FOR_DELIVERY
 * POST /api/delivery/assignments/:orderId/verify-pickup-otp
 */
export const verifyPickupOtp = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { orderId } = req.params;
    const { otp } = req.body;

    if (!otp) {
      return next(new AppError("Pickup OTP is required", 400));
    }

    // Include +pickupOtp.code to read hashed code
    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryBoy: deliveryBoy._id,
    })
      .select("+pickupOtp.code")
      .populate("vendor customer");

    if (!order) {
      return next(new AppError("Order not found or not assigned to you", 404));
    }

    if (order.pickedUpAt) {
      return next(new AppError("Order has already been picked up", 400));
    }

    // Check attempts limit (max 3 failed attempts)
    if (order.pickupOtp.attempts >= 3) {
      return next(
        new AppError(
          "Maximum pickup OTP attempts exceeded. Please contact store management.",
          429
        )
      );
    }

    // Check expiry
    if (order.pickupOtp.expiresAt && order.pickupOtp.expiresAt < new Date()) {
      return next(new AppError("Pickup OTP has expired. Please request a new code.", 400));
    }

    const isValid = await verifyHashedOTP(otp, order.pickupOtp.code);
    if (!isValid) {
      order.pickupOtp.attempts += 1;
      await order.save();
      const remaining = 3 - order.pickupOtp.attempts;
      return next(
        new AppError(
          `Invalid Pickup OTP. ${remaining} attempt(s) remaining.`,
          400
        )
      );
    }

    // Successful Pickup Verification
    const now = new Date();
    order.pickupOtp.verifiedAt = now;
    order.pickedUpAt = now;
    order.orderStatus = "OUT_FOR_DELIVERY";
    order.statusHistory.push({
      status: "OUT_FOR_DELIVERY",
      timestamp: now,
      updatedBy: req.user._id,
      reason: "Pickup OTP verified. Order handed over to delivery partner.",
    });
    await order.save();

    // Notify customer and vendor in real-time
    emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
    emitToOrderRoom(order._id.toString(), "delivery:order:picked_up", {
      orderId: order._id,
      pickedUpAt: now,
      orderStatus: "OUT_FOR_DELIVERY",
    });

    // Notify customer: Order Picked Up & Out for Delivery (In-App, Push & Socket)
    await notifyCustomerOrderPickedUp(order, deliveryBoy);
    await notifyCustomerOrderOutForDelivery(order, deliveryBoy);

    if (order.vendor) {
      const vId = order.vendor._id || order.vendor;
      const vendorNotif = await VendorNotification.create({
        vendor: vId,
        order: order._id,
        type: "ORDER_PICKED_UP",
        title: "Order Picked Up",
        message: `Order #${order.orderNumber} picked up by ${deliveryBoy.fullName} and is out for delivery.`,
        data: {
          orderNumber: order.orderNumber,
          deliveryBoyName: deliveryBoy.fullName,
        },
      });
      emitVendorNotification(vId.toString(), vendorNotif);
    }

    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_out_for_delivery",
      title: "Out for Delivery 🛵",
      message: `Package collected for #${order.orderNumber}. Head to customer delivery address.`,
      data: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
      },
      category: "delivery",
    });

    res.status(200).json({
      success: true,
      message: "Pickup OTP verified successfully. Package received. Start delivery.",
      orderStatus: "OUT_FOR_DELIVERY",
      pickedUpAt: now,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark Arrived at Customer Doorstep
 * POST /api/delivery/assignments/:orderId/arrived-customer
 */
export const markArrivedAtCustomer = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { orderId } = req.params;
    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryBoy: deliveryBoy._id,
    }).populate("vendor customer");

    if (!order) {
      return next(new AppError("Order not found or not assigned to you", 404));
    }

    order.arrivedAtCustomerAt = new Date();
    order.statusHistory.push({
      status: "ARRIVED_AT_CUSTOMER",
      timestamp: new Date(),
      updatedBy: req.user._id,
      reason: "Delivery partner has arrived at the customer doorstep",
    });
    await order.save();

    emitToOrderRoom(order._id.toString(), "delivery:arrived_customer", {
      orderId: order._id,
      timestamp: order.arrivedAtCustomerAt,
    });

    res.status(200).json({
      success: true,
      message: "Marked arrived at customer address. Ask the customer for their Delivery OTP.",
      orderStatus: order.orderStatus,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify Customer Delivery OTP and Complete Order
 * POST /api/delivery/assignments/:orderId/verify-delivery-otp
 */
export const verifyDeliveryOtp = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { orderId } = req.params;
    const { otp, paymentMode } = req.body;

    if (!otp) {
      return next(new AppError("Customer Delivery OTP is required", 400));
    }

    const order = await Order.findOne({
      _id: orderId,
      assignedDeliveryBoy: deliveryBoy._id,
    })
      .select("+deliveryOtp.code")
      .populate("vendor customer");

    if (!order) {
      return next(new AppError("Order not found or not assigned to you", 404));
    }

    if (order.deliveredAt || order.orderStatus === "DELIVERED") {
      return next(new AppError("Order has already been completed and delivered", 400));
    }

    // Check attempts
    if (order.deliveryOtp.attempts >= 3) {
      return next(
        new AppError(
          "Maximum delivery OTP attempts exceeded. Please contact customer support.",
          429
        )
      );
    }

    // Check expiry
    if (order.deliveryOtp.expiresAt && order.deliveryOtp.expiresAt < new Date()) {
      return next(new AppError("Delivery OTP has expired.", 400));
    }

    const isValid = await verifyHashedOTP(otp, order.deliveryOtp.code);
    if (!isValid) {
      order.deliveryOtp.attempts += 1;
      await order.save();
      const remaining = 3 - order.deliveryOtp.attempts;
      return next(
        new AppError(
          `Invalid Delivery OTP. ${remaining} attempt(s) remaining.`,
          400
        )
      );
    }

    // Successful Delivery Verification
    const now = new Date();
    order.deliveryOtp.verifiedAt = now;
    order.deliveredAt = now;
    order.orderStatus = "DELIVERED";

    // ── Handle Vendor Accounting, COD Custody & Wallet Settlement ──
    const vendor = await Vendor.findById(order.vendor?._id || order.vendor);
    if (vendor) {
      if (
        order.paymentMethod === "Cash on delivery" &&
        (paymentMode === "DIRECT_QR" || paymentMode === "ONLINE")
      ) {
        await recordCodDoorstepCollection(order, deliveryBoy, {
          paymentMode: "DIRECT_QR",
          now,
        });
      } else if (order.paymentMethod === "Cash on delivery") {
        await recordCodDoorstepCollection(order, deliveryBoy, {
          paymentMode: "CASH",
          collectedAmount: req.body.collectedAmount !== undefined ? req.body.collectedAmount : null,
          discrepancyReason: req.body.discrepancyReason || "",
          now,
        });
      } else {
        // Online Payment Settlement (Gateway Verified Ledger)
        await recordOnlineOrderPayment(order, {
          paymentProvider: order.paymentMethod || "ONLINE_GATEWAY",
        });
      }
    }

    order.statusHistory.push({
      status: "DELIVERED",
      timestamp: now,
      updatedBy: req.user._id,
      reason: "Customer Delivery OTP verified. Handover completed.",
    });
    await order.save();

    // Update assignment status and get assignment reference
    const assignment = await DeliveryAssignment.findOneAndUpdate(
      { order: order._id, deliveryBoy: deliveryBoy._id },
      { $set: { status: "COMPLETED", completedAt: now } },
      { new: true }
    );

    // Calculate Delivery Earnings
    // RULE: Credit ₹30 as the delivery earning for eligible successfully completed COD delivery
    const isCod = order.paymentMethod === "Cash on delivery";
    let basePay = 30;
    let distancePay = 0;
    let tip = order.deliveryEarnings?.tip || 0;
    let totalEarnings = 30 + tip;

    if (!isCod) {
      basePay = order.deliveryEarnings?.basePay || 40;
      distancePay = order.deliveryEarnings?.distancePay || 20;
      totalEarnings = basePay + distancePay + tip;
    } else if (
      order.deliveryEarnings?.total &&
      order.deliveryEarnings.total !== 60 &&
      order.deliveryEarnings.total !== 30
    ) {
      // Respect configured specific order rule if explicitly set
      basePay = order.deliveryEarnings.basePay || order.deliveryEarnings.total;
      distancePay = order.deliveryEarnings.distancePay || 0;
      totalEarnings = order.deliveryEarnings.total;
    }

    // Strict Idempotency Check: prevent duplicate earnings on retries or duplicate events
    const earningIdempotencyKey = `EARN-${order._id}`;
    const existingLedger = await DeliveryEarningsLedger.findOne({
      $or: [{ order: order._id }, { idempotencyKey: earningIdempotencyKey }],
    });

    if (!existingLedger) {
      // Credit DeliveryEarningsLedger linked to order & deliveryAssignment
      await DeliveryEarningsLedger.create({
        deliveryBoy: deliveryBoy._id,
        order: order._id,
        deliveryAssignment: assignment?._id || null,
        basePay,
        distancePay,
        customerTip: tip,
        totalEarnings,
        distanceKm: 2.0,
        settlementStatus: "PENDING",
        paymentMethod: order.paymentMethod,
        earningType: isCod ? "COD_DELIVERY" : "ONLINE_DELIVERY",
        idempotencyKey: earningIdempotencyKey,
      });

      // Credit wallet balance exactly once
      deliveryBoy.wallet.currentBalance = Math.round(((deliveryBoy.wallet.currentBalance || 0) + totalEarnings) * 100) / 100;
      deliveryBoy.wallet.totalEarned = Math.round(((deliveryBoy.wallet.totalEarned || 0) + totalEarnings) * 100) / 100;
    }

    // Update DeliveryBoy Availability & metrics
    deliveryBoy.availability = "ONLINE"; // Available for next delivery
    deliveryBoy.activeOrderId = null;
    deliveryBoy.metrics.totalDeliveries += 1;
    await deliveryBoy.save();

    // Real-time broadcast
    emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
    emitToOrderRoom(order._id.toString(), "delivery:order:delivered", {
      orderId: order._id,
      deliveredAt: now,
      orderStatus: "DELIVERED",
      earningsEarned: totalEarnings,
    });

    // Customer Notification: Order Delivered Successfully (In-App, Push & Socket)
    await notifyCustomerOrderDelivered(order);

    // Dedicated Delivery & Earnings Notifications for Rider
    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_completed",
      title: "Delivery Completed Successfully! 🎉",
      message: `Order #${order.orderNumber} delivered to customer. Great job!`,
      data: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
      },
      category: "delivery",
    });

    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_earnings_updated",
      title: "Delivery Earnings Credited 💰",
      message: `+NPR ${totalEarnings} credited to your Delivery Wallet for #${order.orderNumber}.`,
      data: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain/wallet",
        amount: totalEarnings,
      },
      category: "payments",
    });

    res.status(200).json({
      success: true,
      message: "Order delivered successfully! Earnings credited to your wallet.",
      orderStatus: "DELIVERED",
      deliveredAt: now,
      earnings: {
        basePay,
        distancePay,
        tip,
        totalEarnings,
      },
      walletBalance: deliveryBoy.wallet.currentBalance,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delivery partner cancels active delivery and returns package to vendor
 * POST /api/delivery/assignments/:orderId/cancel-delivery
 */
export const cancelActiveDelivery = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { orderId } = req.params;
    const { reason = "Customer unavailable", notes = "" } = req.body;

    if (!deliveryBoy.activeOrderId || deliveryBoy.activeOrderId.toString() !== orderId) {
      return next(
        new AppError("You do not have an active delivery assignment for this order", 400)
      );
    }

    const order = await Order.findById(orderId).populate("vendor customer");
    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    // Update assignment status for current delivery boy to CANCELLED
    await DeliveryAssignment.findOneAndUpdate(
      {
        order: order._id,
        deliveryBoy: deliveryBoy._id,
        status: { $in: ["ACCEPTED", "OFFERED"] },
      },
      {
        $set: {
          status: "CANCELLED",
          rejectionReason: `Delivery cancelled by partner: ${reason}. Notes: ${notes}`,
        },
      }
    );

    // Free the delivery partner immediately
    deliveryBoy.activeOrderId = null;
    deliveryBoy.availability = "ONLINE";
    await deliveryBoy.save();

    await createDeliveryNotification({
      deliveryBoyId: deliveryBoy._id,
      userId: req.user._id,
      type: "delivery_cancelled",
      title: "Delivery Cancelled",
      message: `Delivery for #${order.orderNumber} was cancelled (${reason}). Return package to store.`,
      data: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
      },
      category: "delivery",
    });

    // Increment delivery cancellation attempt counter
    order.deliveryCancellationCount = (order.deliveryCancellationCount || 0) + 1;
    order.cancellationDetails.push({
      cancelledBy: deliveryBoy._id,
      reason,
      notes,
      cancelledAt: new Date(),
      returnedToVendor: true,
    });

    const MAX_DELIVERY_ATTEMPTS = 3;

    // Rule: 3 or more failed delivery cancellations permanently cancels the order
    if (order.deliveryCancellationCount >= MAX_DELIVERY_ATTEMPTS) {
      order.orderStatus = "CANCELLED";
      order.assignedDeliveryBoy = null;
      order.rejectionReason = `Order automatically cancelled after ${order.deliveryCancellationCount} failed delivery attempts. Last reason: ${reason}`;
      order.statusHistory.push({
        status: "CANCELLED",
        timestamp: new Date(),
        updatedBy: req.user._id,
        reason: order.rejectionReason,
      });
      await order.save();

      // Restock inventory
      if (Array.isArray(order.items)) {
        for (const item of order.items) {
          if (item.product) {
            await Product.findByIdAndUpdate(item.product, {
              $inc: { stock: item.quantity, ordersCount: -item.quantity },
            }).catch(() => {});
          }
        }
      }

      // Notify vendor and customer in real-time
      emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
      await notifyCustomerOrderCancelled(order, order.rejectionReason);
      emitToOrderRoom(order._id.toString(), "order:delivery:failed_permanent", {
        orderId: order._id,
        orderNumber: order.orderNumber,
        deliveryCancellationCount: order.deliveryCancellationCount,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        reason: order.rejectionReason,
      });

      return res.status(200).json({
        success: true,
        orderCancelled: true,
        deliveryCancellationCount: order.deliveryCancellationCount,
        maxAttempts: MAX_DELIVERY_ATTEMPTS,
        message: `Order permanently cancelled as maximum delivery attempts (${MAX_DELIVERY_ATTEMPTS}) reached. Package returned to store.`,
        order,
      });
    }

    // Under 3 cancellations: Reset order to READY_FOR_PICKUP for re-dispatch
    order.orderStatus = "READY_FOR_PICKUP";
    order.assignedDeliveryBoy = null;
    order.arrivedAtStoreAt = null;
    order.pickedUpAt = null;
    order.arrivedAtCustomerAt = null;

    order.statusHistory.push({
      status: "READY_FOR_PICKUP",
      timestamp: new Date(),
      updatedBy: req.user._id,
      reason: `Delivery attempt ${order.deliveryCancellationCount} cancelled (${reason}). Package returned to store. Re-dispatching to next nearest partner.`,
    });
    await order.save();

    // Broadcast update to vendor and customer
    emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
    emitToOrderRoom(order._id.toString(), "order:delivery:returned", {
      orderId: order._id,
      orderNumber: order.orderNumber,
      deliveryCancellationCount: order.deliveryCancellationCount,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      reason,
      message: "Package returned to store. System will dispatch to the next nearest partner.",
    });

    // Re-dispatch order to the next nearest partner (previous partners are excluded automatically)
    setTimeout(() => {
      dispatchOrderToNearestPartner(order._id).catch((err) =>
        console.error("[Re-dispatch after delivery cancellation error]:", err)
      );
    }, 1500);

    return res.status(200).json({
      success: true,
      orderCancelled: false,
      deliveryCancellationCount: order.deliveryCancellationCount,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
      message: `Delivery cancelled. Package returned to vendor. Re-dispatching to next nearest partner (Attempt ${order.deliveryCancellationCount} of ${MAX_DELIVERY_ATTEMPTS}).`,
      order,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get assigned return pickups for logged in delivery partner
 * GET /api/delivery/assignments/return-pickups
 */
export const getAssignedReturnPickups = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const returnPickups = await Refund.find({
      "pickup.deliveryBoy": deliveryBoy._id,
      "pickup.status": { $in: ["ASSIGNED", "OUT_FOR_PICKUP"] },
    })
      .populate("order", "orderNumber totalAmount paymentMethod deliveryAddress items")
      .populate("vendor", "businessDetails sellerDetails shippingLocations phone")
      .populate("customer", "name phone email")
      .sort({ "pickup.scheduledAt": -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: returnPickups.length,
      data: returnPickups,
    });
  } catch (error) {
    next(error);
  }
};

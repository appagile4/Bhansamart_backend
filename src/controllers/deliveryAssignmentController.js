import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  verifyHashedOTP,
  dispatchOrderToNearestPartner,
} from "../utils/dispatchEngine.js";
import {
  emitOrderStatusUpdate,
  emitToOrderRoom,
  emitToDeliveryPartner,
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
      .populate("vendor", "businessDetails sellerDetails shippingLocations")
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
          name: order.vendor?.businessDetails?.businessName || "Vendor Store",
          phone: order.vendor?.sellerDetails?.sellerPhone || "",
          address:
            order.vendor?.shippingLocations?.warehouseAddress ||
            order.vendor?.sellerDetails?.address ||
            "",
          city: order.vendor?.shippingLocations?.city || "",
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
      { new: true }
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
      { new: true }
    ).populate("vendor customer");

    if (!order) {
      // Rollback assignment status if order was somehow taken
      assignment.status = "CANCELLED";
      await assignment.save();
      return next(new AppError("Order has already been assigned to another partner", 409));
    }

    // Mark delivery partner as BUSY
    deliveryBoy.availability = "BUSY";
    deliveryBoy.activeOrderId = order._id;
    await deliveryBoy.save();

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
      },
      { new: true }
    );

    if (!assignment) {
      return next(new AppError("Assignment not found or offer is no longer valid", 404));
    }

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
    const { otp } = req.body;

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

    // If Cash on delivery, mark payment as paid upon handover
    if (order.paymentMethod === "Cash on delivery") {
      order.paymentStatus = "paid";
    }

    order.statusHistory.push({
      status: "DELIVERED",
      timestamp: now,
      updatedBy: req.user._id,
      reason: "Customer Delivery OTP verified. Handover completed.",
    });
    await order.save();

    // Update assignment status
    await DeliveryAssignment.findOneAndUpdate(
      { order: order._id, deliveryBoy: deliveryBoy._id },
      { $set: { status: "COMPLETED" } }
    );

    // Calculate Delivery Earnings
    const basePay = order.deliveryEarnings?.basePay || 40;
    const distancePay = order.deliveryEarnings?.distancePay || 20;
    const tip = order.deliveryEarnings?.tip || 0;
    const totalEarnings = basePay + distancePay + tip;

    // Credit DeliveryEarningsLedger (Strict separation from security deposit)
    await DeliveryEarningsLedger.create({
      deliveryBoy: deliveryBoy._id,
      order: order._id,
      basePay,
      distancePay,
      customerTip: tip,
      totalEarnings,
      distanceKm: 2.0,
      settlementStatus: "PENDING",
    });

    // Update DeliveryBoy Wallet and Availability
    deliveryBoy.availability = "ONLINE"; // Available for next delivery
    deliveryBoy.activeOrderId = null;
    deliveryBoy.metrics.totalDeliveries += 1;
    deliveryBoy.wallet.currentBalance += totalEarnings;
    deliveryBoy.wallet.totalEarned += totalEarnings;
    await deliveryBoy.save();

    // Real-time broadcast
    emitOrderStatusUpdate(order._id.toString(), order.customer?._id?.toString(), order);
    emitToOrderRoom(order._id.toString(), "delivery:order:delivered", {
      orderId: order._id,
      deliveredAt: now,
      orderStatus: "DELIVERED",
      earningsEarned: totalEarnings,
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

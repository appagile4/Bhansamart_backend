import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import VendorTransaction from "../models/VendorTransaction.js";
import VendorNotification from "../models/VendorNotification.js";
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

    // Persistent vendor notification
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
      if (!vendor.wallet) {
        vendor.wallet = {
          currentBalance: 0,
          totalEarned: 0,
          pendingSettlement: 0,
          codCashWithDeliveryBoys: 0,
        };
      }

      // Check if rider completed payment via Direct Store QR / UPI at customer doorstep
      if (
        order.paymentMethod === "Cash on delivery" &&
        (paymentMode === "DIRECT_QR" || paymentMode === "ONLINE")
      ) {
        order.paymentStatus = "paid";
        order.paymentMethod = "Vendor QR Code (Direct)";
        order.codDetails = {
          cashCollectedByRider: false,
          cashCollectedAmount: 0,
          cashCollectedAt: null,
          cashSubmittedToVendor: false,
          handoverReceipt: "DIRECT_QR_PAID",
          isDirectVendorQrPaid: true,
          directQrPaidAt: now,
        };

        // Note: No physical cash collected, so physical custody is NOT incremented:
        // deliveryBoy.codCashInCustody is untouched
        // vendor.wallet.codCashWithDeliveryBoys is untouched
        // vendor.wallet.currentBalance is NOT credited because the store received money directly into their bank/UPI

        // Record Vendor Transaction with Idempotency Key
        const directQrTxnKey = `TXN-DIRECT-QR-${order._id}`;
        const existingTxn = await VendorTransaction.findOne({ idempotencyKey: directQrTxnKey });
        if (!existingTxn) {
          await VendorTransaction.create({
            vendor: vendor._id,
            order: order._id,
            deliveryBoy: deliveryBoy._id,
            type: "DIRECT_QR_PAYMENT",
            amount: order.totalAmount,
            grossAmount: order.totalAmount,
            netAmount: order.totalAmount,
            paymentMethod: "Vendor QR Code (Direct)",
            status: "DIRECT_SETTLED",
            idempotencyKey: directQrTxnKey,
            notes: `Direct UPI/QR payment received by store account at customer doorstep for Order #${order.orderNumber} via ${deliveryBoy.fullName}. Not added to wallet balance as store already received funds directly.`,
          });
        }

        // Persistent Vendor Notification
        const vendorNotif = await VendorNotification.create({
          vendor: vendor._id,
          order: order._id,
          type: "PAYMENT_RECEIVED",
          title: "Direct QR Payment Received",
          message: `Customer paid NPR ${order.totalAmount} directly to your Store QR/UPI for Order #${order.orderNumber} via delivery partner ${deliveryBoy.fullName}.`,
          data: {
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
            deliveryBoyName: deliveryBoy.fullName,
            paymentMethod: "Vendor QR Code (Direct)",
          },
        });

        emitVendorNotification(vendor._id.toString(), vendorNotif);
      } else if (order.paymentMethod === "Cash on delivery") {
        order.paymentStatus = "paid";
        order.codDetails = {
          cashCollectedByRider: true,
          cashCollectedAmount: order.totalAmount,
          cashCollectedAt: now,
          cashSubmittedToVendor: false,
          handoverReceipt: "",
          isDirectVendorQrPaid: false,
          directQrPaidAt: null,
        };

        // Increment Delivery Boy's physical cash custody
        deliveryBoy.codCashInCustody = (deliveryBoy.codCashInCustody || 0) + order.totalAmount;

        // Increment Vendor's COD custody tracker (STRICTLY NOT credited to withdrawable balance)
        vendor.wallet.codCashWithDeliveryBoys =
          (vendor.wallet.codCashWithDeliveryBoys || 0) + order.totalAmount;
        await vendor.save();

        // Record Vendor Transaction with Idempotency Key
        const codTxnKey = `TXN-COD-COLL-${order._id}`;
        const existingTxn = await VendorTransaction.findOne({ idempotencyKey: codTxnKey });
        if (!existingTxn) {
          await VendorTransaction.create({
            vendor: vendor._id,
            order: order._id,
            deliveryBoy: deliveryBoy._id,
            type: "COD_COLLECTION",
            amount: order.totalAmount,
            grossAmount: order.totalAmount,
            netAmount: order.totalAmount,
            paymentMethod: "Cash on delivery",
            status: "CASH_IN_CUSTODY",
            idempotencyKey: codTxnKey,
            notes: `Cash collected by ${deliveryBoy.fullName} for Order #${order.orderNumber}. Handover pending at store counter.`,
          });
        }

        // Persistent Vendor Notification
        const vendorNotif = await VendorNotification.create({
          vendor: vendor._id,
          order: order._id,
          type: "COD_COLLECTED",
          title: "COD Cash Collected",
          message: `Delivery partner ${deliveryBoy.fullName} collected NPR ${order.totalAmount} for order #${order.orderNumber}. Cash handover pending at your store.`,
          data: {
            orderNumber: order.orderNumber,
            totalAmount: order.totalAmount,
            deliveryBoyName: deliveryBoy.fullName,
          },
        });

        emitVendorNotification(vendor._id.toString(), vendorNotif);
        emitVendorCodUpdate(vendor._id.toString(), {
          orderId: order._id,
          orderNumber: order.orderNumber,
          collectedAmount: order.totalAmount,
          codCashWithDeliveryBoys: vendor.wallet.codCashWithDeliveryBoys,
        });
      } else {
        // Online Payment Settlement
        order.paymentStatus = "paid";
        const grossAmount = order.totalAmount;
        const commission = 0; // 0% promotional platform commission
        const netAmount = grossAmount - commission;

        const onlineTxnKey = `TXN-ORD-${order._id}`;
        const existingTxn = await VendorTransaction.findOne({ idempotencyKey: onlineTxnKey });
        if (!existingTxn) {
          await VendorTransaction.create({
            vendor: vendor._id,
            order: order._id,
            type: "ORDER_EARNING",
            amount: netAmount,
            grossAmount,
            commission,
            netAmount,
            paymentMethod: order.paymentMethod,
            status: "SETTLED",
            idempotencyKey: onlineTxnKey,
            notes: `Online order payout for Order #${order.orderNumber}`,
          });

          // Add to vendor withdrawable wallet
          vendor.wallet.currentBalance += netAmount;
          vendor.wallet.totalEarned += netAmount;
          await vendor.save();
        }

        const vendorNotif = await VendorNotification.create({
          vendor: vendor._id,
          order: order._id,
          type: "ORDER_DELIVERED",
          title: "Order Delivered & Settled",
          message: `Order #${order.orderNumber} delivered. NPR ${netAmount} credited to your withdrawable balance.`,
          data: {
            orderNumber: order.orderNumber,
            netAmount,
          },
        });

        emitVendorNotification(vendor._id.toString(), vendorNotif);
        emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);
      }
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

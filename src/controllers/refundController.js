import Refund from "../models/Refund.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { processOrderRefund } from "../services/financeLedgerService.js";
import { emitOrderStatusUpdate } from "../socket/socketManager.js";

/**
 * @desc    Customer submits a Cancellation, Return, Refund or Replacement request
 * @route   POST /api/refunds/request
 * @access  Private (Customer)
 */
export const requestRefund = async (req, res, next) => {
  try {
    const customerId = req.user._id;
    const {
      orderId,
      claimType = "CANCELLATION",
      items,
      reason,
      description,
      proofImages = [],
      customerPayoutDetails = {},
    } = req.body;

    if (!orderId) {
      return next(new AppError("Order ID is required", 400));
    }

    if (!reason || !reason.trim()) {
      return next(new AppError("Reason for return or refund is required", 400));
    }

    const order = await Order.findOne({
      _id: orderId,
      customer: customerId,
    }).populate("vendor");

    if (!order) {
      return next(new AppError("Order not found or unauthorized", 404));
    }

    // Check if order is already cancelled or fully refunded
    if (order.orderStatus === "CANCELLED" || order.paymentStatus === "refunded") {
      return next(new AppError("Order is already cancelled or refunded", 400));
    }

    // Check for duplicate pending requests on this order
    const pendingExisting = await Refund.findOne({
      order: order._id,
      status: { $in: ["REQUESTED", "APPROVED", "PROCESSING"] },
    });
    if (pendingExisting) {
      return next(
        new AppError(
          "A return/refund request is already being processed for this order.",
          400
        )
      );
    }

    // Calculate claim items and total refundable amount
    let targetItems = [];
    let claimAmount = 0;

    if (items && Array.isArray(items) && items.length > 0) {
      // Partial return/refund
      for (const clientItem of items) {
        const pId = String(clientItem.productId || clientItem.id || clientItem._id);
        const ordItem = order.items.find(
          (i) => i.product.toString() === pId || i.productId === pId
        );
        if (!ordItem) {
          return next(new AppError(`Item ${pId} was not part of this order`, 400));
        }

        const qty = Math.min(
          ordItem.quantity,
          Math.max(1, Number(clientItem.quantity) || 1)
        );
        const itemTotal = ordItem.price * qty;

        targetItems.push({
          product: ordItem.product,
          productId: ordItem.productId,
          name: ordItem.name,
          price: ordItem.price,
          quantity: qty,
          imageUrl: ordItem.imageUrl,
        });

        claimAmount += itemTotal;
      }
    } else {
      // Full order return/refund
      targetItems = order.items.map((i) => ({
        product: i.product,
        productId: i.productId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        imageUrl: i.imageUrl,
      }));
      claimAmount = order.totalAmount;
    }

    // ── Instant Cancellation Rule: If order is not yet dispatched, cancel and refund immediately! ──
    const canInstantCancel =
      claimType === "CANCELLATION" &&
      ["PLACED", "ACCEPTED", "PREPARING"].includes(order.orderStatus);

    if (canInstantCancel) {
      const refundResult = await processOrderRefund({
        order,
        items: targetItems,
        refundAmount: claimAmount,
        reason: reason.trim(),
        description: description || "Immediate pre-dispatch customer cancellation",
        proofImages,
        claimType: "CANCELLATION",
        customerPayoutDetails,
        reviewedBy: customerId,
        idempotencyKey: `CANC-${order._id}-${Date.now()}`,
      });

      return res.status(200).json({
        success: true,
        message: "Order cancelled and refund processed successfully.",
        data: refundResult.refund,
      });
    }

    // For delivered orders (returns, damaged, replacements), create request for vendor/admin approval
    const refundNumber = await Refund.generateRefundNumber();

    const refund = await Refund.create({
      refundNumber,
      order: order._id,
      orderNumber: order.orderNumber,
      customer: customerId,
      vendor: order.vendor._id,
      claimType,
      items: targetItems,
      amount: claimAmount,
      originalPaymentMethod: order.paymentMethod,
      reason: reason.trim(),
      description: description || "",
      proofImages,
      status: "REQUESTED",
      customerPayoutDetails: {
        method: customerPayoutDetails.method || (order.paymentMethod === "Cash on delivery" ? "UPI" : "GATEWAY_REVERSAL"),
        upiId: customerPayoutDetails.upiId || "",
        accountNumber: customerPayoutDetails.accountNumber || "",
        bankName: customerPayoutDetails.bankName || "",
        accountHolderName: customerPayoutDetails.accountHolderName || "",
      },
    });

    order.refundStatus = "REQUESTED";
    await order.save();

    const orderObj = order.toObject ? order.toObject() : { ...order };
    orderObj.refundDetails = refund.toObject ? refund.toObject() : refund;
    emitOrderStatusUpdate(order._id.toString(), customerId.toString(), orderObj);

    res.status(201).json({
      success: true,
      message: `${claimType === "REPLACEMENT" ? "Replacement" : "Refund"} request submitted successfully. Awaiting review.`,
      data: refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Vendor or Admin approves return / refund / replacement request
 * @route   PATCH /api/refunds/:id/approve
 * @access  Private (Vendor / Admin)
 */
export const approveRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminNotes, customerPayoutDetails } = req.body;

    const refund = await Refund.findById(id).populate("order");
    if (!refund) {
      return next(new AppError("Refund request not found", 404));
    }

    if (refund.status === "COMPLETED") {
      return next(new AppError("Refund has already been completed", 400));
    }

    const order = await Order.findById(refund.order._id || refund.order);
    if (!order) {
      return next(new AppError("Associated order not found", 404));
    }

    // Authorize: Admin or store vendor
    let isAuthorized = req.user.role === "admin" || req.user.role === "superadmin";
    if (!isAuthorized) {
      const vendor = await Vendor.findOne({ userId: req.user._id });
      if (vendor && vendor._id.toString() === refund.vendor.toString()) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return next(new AppError("Unauthorized to approve this refund", 403));
    }

    const payoutInfo = customerPayoutDetails || refund.customerPayoutDetails || {};

    // Execute full financial reversal and ledger settlement
    const result = await processOrderRefund({
      order,
      items: refund.items,
      refundAmount: refund.amount,
      reason: refund.reason,
      description: refund.description,
      proofImages: refund.proofImages,
      claimType: refund.claimType,
      customerPayoutDetails: payoutInfo,
      reviewedBy: req.user._id,
      idempotencyKey: `APP-REF-${refund._id}`,
    });

    // Mark original refund record completed
    refund.status = "COMPLETED";
    refund.reviewedBy = req.user._id;
    refund.reviewedAt = new Date();
    refund.adminNotes = adminNotes || "Approved by vendor/admin";
    await refund.save();

    const freshOrder = await Order.findById(order._id)
      .populate("vendor customer")
      .lean();
    if (freshOrder) {
      freshOrder.refundDetails = refund.toObject();
      emitOrderStatusUpdate(
        freshOrder._id.toString(),
        freshOrder.customer?._id?.toString(),
        freshOrder
      );
    }

    res.status(200).json({
      success: true,
      message: `${refund.claimType} approved and financial ledger adjusted successfully.`,
      data: {
        refund,
        vendorDeduction: result.vendorDeduction,
        commissionReversal: result.commissionReversal,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Vendor or Admin rejects return / refund / replacement request
 * @route   PATCH /api/refunds/:id/reject
 * @access  Private (Vendor / Admin)
 */
export const rejectRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || !rejectionReason.trim()) {
      return next(new AppError("Rejection reason is required", 400));
    }

    const refund = await Refund.findById(id);
    if (!refund) {
      return next(new AppError("Refund request not found", 404));
    }

    if (refund.status === "COMPLETED") {
      return next(new AppError("Cannot reject an already completed refund", 400));
    }

    refund.status = "REJECTED";
    refund.rejectionReason = rejectionReason.trim();
    refund.reviewedBy = req.user._id;
    refund.reviewedAt = new Date();
    await refund.save();

    // Update order refundStatus to REJECTED so customer sees the rejection state & reason
    const updatedOrder = await Order.findByIdAndUpdate(
      refund.order,
      {
        $set: { refundStatus: "REJECTED" },
        $push: {
          statusHistory: {
            status: "REFUND_REJECTED",
            timestamp: new Date(),
            updatedBy: req.user._id,
            reason: `Claim rejected: ${rejectionReason.trim()}`,
          },
        },
      },
      { returnDocument: "after" }
    ).populate("vendor customer");

    if (updatedOrder) {
      const orderObj = updatedOrder.toObject();
      orderObj.refundDetails = refund.toObject();
      emitOrderStatusUpdate(
        updatedOrder._id.toString(),
        updatedOrder.customer?._id?.toString(),
        orderObj
      );
    }

    res.status(200).json({
      success: true,
      message: "Refund request rejected.",
      data: refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get customer's refund and claim history
 * @route   GET /api/refunds/my-refunds
 * @access  Private (Customer)
 */
export const getMyRefunds = async (req, res, next) => {
  try {
    const customerId = req.user._id;
    const refunds = await Refund.find({ customer: customerId })
      .populate("order", "orderNumber totalAmount paymentMethod orderStatus")
      .populate("vendor", "businessDetails.businessName brandDetails.brandLogo")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: refunds.length,
      data: refunds,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get vendor's refunds and claim requests
 * @route   GET /api/refunds/vendor
 * @access  Private (Vendor)
 */
export const getVendorRefunds = async (req, res, next) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor) {
      return next(new AppError("Vendor not found", 404));
    }

    const { status } = req.query;
    const query = { vendor: vendor._id };
    if (status && status !== "ALL") {
      query.status = status;
    }

    const refunds = await Refund.find(query)
      .populate("order", "orderNumber totalAmount paymentMethod orderStatus")
      .populate("customer", "name phone email")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: refunds.length,
      data: refunds,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get refund details by ID
 * @route   GET /api/refunds/:id
 * @access  Private
 */
export const getRefundById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const refund = await Refund.findById(id)
      .populate("order")
      .populate("customer", "name phone email")
      .populate("vendor", "businessDetails.businessName")
      .lean();

    if (!refund) {
      return next(new AppError("Refund not found", 404));
    }

    res.status(200).json({
      success: true,
      data: refund,
    });
  } catch (error) {
    next(error);
  }
};

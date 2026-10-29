import Refund, { maskCustomerPayoutDetails } from "../models/Refund.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { processOrderRefund, processReturnPickupAccounting } from "../services/financeLedgerService.js";
import { generateNumericOTP } from "../utils/generateOTP.js";
import { emitOrderStatusUpdate, notifyStaffAdminsForVendor } from "../socket/socketManager.js";
import { notifyCustomerRefundStatusUpdated } from "../services/customerNotificationService.js";

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
      status: { $in: ["REQUESTED", "APPROVED", "PROCESSING", "VENDOR_REVIEW", "STAFF_EXAMINING"] },
    });
    if (pendingExisting) {
      return next(
        new AppError(
          "A return/refund request is already being processed for this order.",
          400
        )
      );
    }

    // Verify COD delivery and cash collection for delivered COD orders
    const isCod = order.paymentMethod === "Cash on delivery";
    if (isCod && claimType !== "CANCELLATION") {
      if (order.orderStatus !== "DELIVERED" || !order.codDetails?.cashCollectedByRider) {
        return next(
          new AppError(
            "Refund cannot be requested for a Cash on Delivery order that has not been successfully delivered and cash collected.",
            400
          )
        );
      }
    }

    // Verify return window if delivered
    if (order.deliveredAt && claimType !== "CANCELLATION") {
      const deliveredDate = new Date(order.deliveredAt);
      const returnWindowDays = order.items?.[0]?.returnWindowDays || 7;
      const windowMs = returnWindowDays * 24 * 60 * 60 * 1000;
      if (Date.now() - deliveredDate.getTime() > windowMs) {
        return next(
          new AppError(
            `Return window of ${returnWindowDays} days has expired for this delivered order.`,
            400
          )
        );
      }
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

    // Validate product eligibility for Return, Replacement or Refund
    if (claimType !== "CANCELLATION") {
      const productIds = targetItems.map((i) => i.product).filter(Boolean);
      if (productIds.length > 0) {
        const dbProducts = await Product.find({ _id: { $in: productIds } });
        const productMap = new Map(dbProducts.map((p) => [p._id.toString(), p]));

        for (const item of targetItems) {
          const prod = productMap.get(String(item.product));
          if (prod) {
            if (
              (claimType === "RETURN" || claimType === "RETURN_REFUND") &&
              !prod.isReturnable
            ) {
              return next(
                new AppError(
                  `Product "${item.name}" is not eligible for return. Only returnable products can be returned.`,
                  400
                )
              );
            }
            if (claimType === "REPLACEMENT" && !prod.isReplaceable) {
              return next(
                new AppError(
                  `Product "${item.name}" is not eligible for replacement.`,
                  400
                )
              );
            }
            if (
              (claimType === "REFUND" || claimType === "DEFECTIVE") &&
              !prod.isRefundable &&
              !prod.isReturnable &&
              !prod.isReplaceable
            ) {
              return next(
                new AppError(
                  `Product "${item.name}" is not eligible for refund or return claims.`,
                  400
                )
              );
            }
          }
        }
      }
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
      isVendorFunded: isCod,
      reason: reason.trim(),
      description: description || "",
      proofImages,
      status: "VENDOR_REVIEW",
      timeline: [
        {
          status: "VENDOR_REVIEW",
          actorRole: "customer",
          actorName: req.user.name || "Customer",
          notes: `Customer initiated ${claimType} request: ${reason.trim()}`,
          timestamp: new Date(),
        },
      ],
      customerPayoutDetails: {
        method: customerPayoutDetails.method || (order.paymentMethod === "Cash on delivery" ? "UPI" : "GATEWAY_REVERSAL"),
        upiId: customerPayoutDetails.upiId || "",
        accountNumber: customerPayoutDetails.accountNumber || "",
        bankName: customerPayoutDetails.bankName || "",
        accountHolderName: customerPayoutDetails.accountHolderName || "",
        ifscCode: customerPayoutDetails.ifscCode || "",
      },
    });

    order.refundStatus = "REQUESTED";
    await order.save();

    const orderObj = order.toObject ? order.toObject() : { ...order };
    orderObj.refundDetails = refund.toObject ? refund.toObject() : refund;
    emitOrderStatusUpdate(order._id.toString(), customerId.toString(), orderObj);

    // Customer Notification: Refund Status Updated (Requested)
    await notifyCustomerRefundStatusUpdated(order, refund, "REQUESTED", reason);

    // Scoped Real-time alert to StaffAdmins assigned to this vendor
    await notifyStaffAdminsForVendor({
      vendorId: order.vendor._id,
      eventType: "staff_refund:new",
      title: `New ${claimType === "REPLACEMENT" ? "Replacement" : "Return"} Claim Submitted`,
      message: `Customer requested ${claimType.toLowerCase()} for Order #${order.orderNumber}. Awaiting store response.`,
      data: { refundId: refund._id, orderId: order._id, claimType, amount: claimAmount },
    });

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
/**
 * @desc    Vendor performs initial review of return/refund/replacement claim
 * @route   PATCH /api/refunds/:id/vendor-review
 * @access  Private (Vendor)
 */
export const vendorReviewRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, notes = "", proofImages = [] } = req.body;

    const refund = await Refund.findById(id).populate("order");
    if (!refund) {
      return next(new AppError("Refund request not found", 404));
    }

    // Verify logged in vendor ownership
    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor || vendor._id.toString() !== refund.vendor.toString()) {
      return next(
        new AppError("Unauthorized. Only the order store vendor can review this request.", 403)
      );
    }

    refund.vendorReview = {
      decision, // ACCEPTED | REJECTED | INFO_REQUIRED
      notes,
      respondedAt: new Date(),
      proofImages,
    };

    if (decision === "ACCEPTED") {
      refund.status = "STAFF_EXAMINING";
    } else if (decision === "REJECTED") {
      refund.status = "VENDOR_REJECTED";
      refund.rejectionReason = notes || "Rejected by vendor initial review";
    } else if (decision === "INFO_REQUIRED") {
      refund.status = "VENDOR_INFO_REQUIRED";
    }

    refund.timeline.push({
      status: refund.status,
      actorRole: "vendor",
      actorName: vendor.businessDetails?.businessName || req.user.name,
      notes: `Vendor decision: ${decision}. Notes: ${notes}`,
      timestamp: new Date(),
    });

    await refund.save();

    // Alert assigned StaffAdmins in real time
    await notifyStaffAdminsForVendor({
      vendorId: refund.vendor,
      eventType: "staff_refund:vendor_responded",
      title: `Vendor ${decision === "ACCEPTED" ? "Accepted" : "Responded to"} Return Claim`,
      message: `Store ${vendor.businessDetails?.businessName} responded to ${refund.refundNumber}. StaffAdmin examination ready.`,
      data: {
        refundId: refund._id,
        refundNumber: refund.refundNumber,
        decision,
        status: refund.status,
      },
    });

    res.status(200).json({
      success: true,
      message: `Vendor review submitted: ${decision}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Vendor submits direct customer payout confirmation for an approved COD refund
 * @route   PATCH /api/refunds/:id/vendor-direct-payout
 * @access  Private (Vendor)
 */
export const vendorDirectRefundPayout = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      paymentMethod = "UPI",
      transactionReference,
      proofImage = "",
      notes = "",
    } = req.body;

    if (!transactionReference || !transactionReference.trim()) {
      return next(new AppError("Payment transaction reference / UTR is required", 400));
    }

    const refund = await Refund.findById(id).populate("order");
    if (!refund) {
      return next(new AppError("Refund request not found", 404));
    }

    if (refund.status === "COMPLETED") {
      return next(new AppError("This refund has already been completed.", 400));
    }

    // Verify vendor ownership
    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor || vendor._id.toString() !== refund.vendor.toString()) {
      return next(
        new AppError("Unauthorized. Only the responsible store vendor can execute direct refund payout.", 403)
      );
    }

    // Strict rule: Vendor only refunds COD orders
    if (!refund.isVendorFunded || (refund.originalPaymentMethod !== "Cash on delivery" && refund.originalPaymentMethod !== "COD")) {
      return next(
        new AppError("Vendors can only directly refund Cash on Delivery (COD) orders. Online payment refunds are managed by Super Admin.", 403)
      );
    }

    const order = await Order.findById(refund.order._id || refund.order);
    if (!order) {
      return next(new AppError("Associated order not found", 404));
    }

    const now = new Date();
    const cleanRef = transactionReference.trim();

    // Execute ledger refund (Vendor funded: no digital wallet deduction, zero commission reversal)
    await processOrderRefund({
      refundId: refund._id,
      order,
      items: refund.items,
      refundAmount: refund.amount,
      reason: refund.reason,
      description: refund.description,
      proofImages: refund.proofImages,
      claimType: refund.claimType,
      customerPayoutDetails: {
        ...refund.customerPayoutDetails,
        method: paymentMethod,
        payoutReference: cleanRef,
        payoutCompletedAt: now,
      },
      reviewedBy: req.user._id,
      idempotencyKey: `VEND-PAY-${refund._id}-${cleanRef}`,
    });

    // Reload refund to ensure version concurrency safety
    const updatedRefund = await Refund.findById(refund._id);
    updatedRefund.status = "COMPLETED";
    updatedRefund.isVendorFunded = true;
    updatedRefund.vendorPaymentDetails = {
      paymentMethod,
      transactionReference: cleanRef,
      proofImage,
      paidAt: now,
      confirmedByVendor: true,
      notes,
    };
    updatedRefund.timeline.push({
      status: "COMPLETED",
      actorRole: "vendor",
      actorName: vendor.businessDetails?.businessName || req.user.name,
      notes: `Vendor sent direct refund of NPR ${refund.amount} via ${paymentMethod}. Reference: ${cleanRef}`,
      timestamp: now,
    });
    await updatedRefund.save();

    // Real-time alerts
    emitOrderStatusUpdate(order._id.toString(), order.customer.toString(), {
      ...order.toObject(),
      refundDetails: updatedRefund.toObject(),
    });

    // Customer Notification: Refund Completed (Vendor Direct Payout)
    await notifyCustomerRefundStatusUpdated(
      order,
      updatedRefund,
      "COMPLETED",
      `Direct payout via ${paymentMethod}. Reference: ${cleanRef}`
    );

    await notifyStaffAdminsForVendor({
      vendorId: vendor._id,
      eventType: "staff_refund:vendor_paid",
      title: "Vendor Direct Refund Completed",
      message: `Store ${vendor.businessDetails?.businessName} paid direct refund of NPR ${refund.amount} to customer. Reference: ${cleanRef}.`,
      data: {
        refundId: refund._id,
        orderId: order._id,
        amount: refund.amount,
        transactionReference: cleanRef,
      },
    });

    res.status(200).json({
      success: true,
      message: "Direct customer refund confirmed and marked as completed.",
      data: refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Vendor acknowledges claim and records planned refund
 * @route   PATCH /api/refunds/:id/vendor-acknowledge
 * @access  Private (Vendor)
 */
export const vendorAcknowledgeClaim = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes = "" } = req.body;

    const refund = await Refund.findById(id).populate("order");
    if (!refund) {
      return next(new AppError("Refund request not found", 404));
    }

    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor || vendor._id.toString() !== refund.vendor.toString()) {
      return next(new AppError("Unauthorized. Only the responsible vendor can acknowledge this claim.", 403));
    }

    refund.vendorReview = {
      decision: "ACCEPTED",
      notes: notes || "Vendor acknowledged claim.",
      respondedAt: new Date(),
    };

    if (refund.isVendorFunded) {
      refund.status = "APPROVED";
    } else {
      refund.status = "STAFF_EXAMINING";
    }

    refund.timeline.push({
      status: refund.status,
      actorRole: "vendor",
      actorName: vendor.businessDetails?.businessName || req.user.name,
      notes: notes || `Vendor acknowledged claim: ${refund.status}`,
      timestamp: new Date(),
    });

    await refund.save();

    res.status(200).json({
      success: true,
      message: `Claim acknowledged by vendor. Status: ${refund.status}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Super Admin executes or marks online payment refund
 * @route   PATCH /api/refunds/:id/superadmin-online-payout
 * @access  Private (Superadmin only)
 */
export const superAdminProcessOnlineRefund = async (req, res, next) => {
  try {
    if (req.user.role !== "superadmin") {
      return next(new AppError("Only Super Admin is authorized to process online payment refunds.", 403));
    }

    const { id } = req.params;
    const {
      payoutReference,
      payoutProofImage = "",
      status = "COMPLETED", // COMPLETED | PROCESSING
      notes = "",
    } = req.body;

    const refund = await Refund.findById(id).populate("order vendor");
    if (!refund) {
      return next(new AppError("Refund record not found", 404));
    }

    if (refund.isVendorFunded) {
      return next(new AppError("This is a COD order. The responsible vendor must refund the customer directly.", 400));
    }

    if (refund.status === "COMPLETED") {
      return next(new AppError("This refund has already been completed.", 400));
    }

    const now = new Date();
    const cleanRef = (payoutReference || "").trim() || `ONL-REF-${Date.now()}`;

    if (status === "PROCESSING") {
      refund.status = "PROCESSING";
      refund.customerPayoutDetails.payoutReference = cleanRef;
      refund.customerPayoutDetails.processedBy = req.user._id;
      refund.customerPayoutDetails.processedByRole = "superadmin";
      refund.timeline.push({
        status: "PROCESSING",
        actorRole: "superadmin",
        actorName: req.user.name || "Super Admin",
        notes: notes || `Super Admin initiated online refund payout. Reference: ${cleanRef}`,
        timestamp: now,
      });
      await refund.save();

      // Customer Notification: Refund Processing
      await notifyCustomerRefundStatusUpdated(
        refund.order,
        refund,
        "PROCESSING",
        `Online payout initiated. Reference: ${cleanRef}`
      );

      return res.status(200).json({
        success: true,
        message: "Online refund marked as processing.",
        refund,
      });
    }

    // Process actual ledger settlement with Super Admin commission preserved intact
    await processOrderRefund({
      refundId: refund._id,
      order: refund.order,
      items: refund.items,
      refundAmount: refund.amount,
      reason: refund.reason,
      description: refund.description,
      proofImages: refund.proofImages,
      claimType: refund.claimType,
      customerPayoutDetails: {
        ...refund.customerPayoutDetails,
        payoutReference: cleanRef,
        payoutProofImage,
        payoutCompletedAt: now,
        processedBy: req.user._id,
        processedByRole: "superadmin",
      },
      reviewedBy: req.user._id,
      idempotencyKey: `SUPER-ONL-PAY-${refund._id}-${cleanRef}`,
    });

    // Reload refund to ensure version concurrency safety
    const updatedRefund = await Refund.findById(refund._id);
    updatedRefund.status = "COMPLETED";
    updatedRefund.customerPayoutDetails.payoutReference = cleanRef;
    updatedRefund.customerPayoutDetails.payoutProofImage = payoutProofImage;
    updatedRefund.customerPayoutDetails.payoutCompletedAt = now;
    updatedRefund.customerPayoutDetails.processedBy = req.user._id;
    updatedRefund.customerPayoutDetails.processedByRole = "superadmin";

    updatedRefund.timeline.push({
      status: "COMPLETED",
      actorRole: "superadmin",
      actorName: req.user.name || "Super Admin",
      notes: notes || `Super Admin executed online refund of NPR ${refund.amount}. Reference: ${cleanRef}`,
      timestamp: now,
    });
    await updatedRefund.save();

    emitOrderStatusUpdate(refund.order._id.toString(), refund.customer.toString(), {
      ...(refund.order.toObject ? refund.order.toObject() : refund.order),
      refundDetails: updatedRefund.toObject ? updatedRefund.toObject() : updatedRefund,
    });

    // Customer Notification: Refund Completed (Online Gateway Payout)
    await notifyCustomerRefundStatusUpdated(
      refund.order,
      updatedRefund,
      "COMPLETED",
      `Online payout of NPR ${refund.amount} completed. Reference: ${cleanRef}`
    );

    res.status(200).json({
      success: true,
      message: `Online refund of NPR ${refund.amount} completed successfully. Reference: ${cleanRef}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Super Admin assigns a Delivery Partner for return pickup and generates OTP
 * @route   PATCH /api/refunds/:id/assign-pickup
 * @access  Private (Superadmin only)
 */
export const adminAssignReturnPickup = async (req, res, next) => {
  try {
    if (req.user.role !== "superadmin") {
      return next(new AppError("Only Super Admin can assign delivery partners for return pickups.", 403));
    }

    const { id } = req.params;
    const { deliveryBoyId, notes = "" } = req.body;

    if (!deliveryBoyId) {
      return next(new AppError("Delivery partner ID is required", 400));
    }

    const refund = await Refund.findById(id).populate("vendor order");
    if (!refund) {
      return next(new AppError("Claim not found", 404));
    }

    const deliveryBoy = await DeliveryBoy.findById(deliveryBoyId);
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner not found", 404));
    }

    // Generate 4-digit numeric OTP for customer pickup verification
    const pickupOtp = generateNumericOTP(4);

    refund.pickup.required = true;
    refund.pickup.deliveryBoy = deliveryBoy._id;
    refund.pickup.otp = pickupOtp;
    refund.pickup.otpExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    refund.pickup.isOtpVerified = false;
    refund.pickup.status = "ASSIGNED";
    refund.pickup.scheduledAt = new Date();
    refund.pickup.notes = notes;
    refund.status = "RETURN_PICKUP_SCHEDULED";

    refund.timeline.push({
      status: "RETURN_PICKUP_SCHEDULED",
      actorRole: "superadmin",
      actorName: req.user.name || "Super Admin",
      notes: `Assigned reverse pickup to partner ${deliveryBoy.fullName || deliveryBoy.name}. Verification OTP generated.`,
      timestamp: new Date(),
    });

    await refund.save();

    res.status(200).json({
      success: true,
      message: `Return pickup assigned to ${deliveryBoy.fullName}. Verification OTP: ${pickupOtp}`,
      refund,
      pickupOtp,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delivery Partner submits return inspection report and verifies OTP
 * @route   PATCH /api/refunds/:id/delivery-inspection
 * @access  Private (Assigned Delivery Partner or Super Admin)
 */
export const deliveryBoySubmitReturnInspection = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      otp,
      condition = "INTACT",
      missingAccessories = "",
      visibleDamage = "",
      quantityCollected = 1,
      location = "",
      proofImages = [],
      notes = "",
      result = "PASSED",
    } = req.body;

    const refund = await Refund.findById(id).populate("vendor order");
    if (!refund) {
      return next(new AppError("Claim not found", 404));
    }

    // Authenticate: delivery boy or superadmin
    let isAuthorized = req.user.role === "superadmin";
    let deliveryBoy = null;
    if (!isAuthorized) {
      deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
      if (
        deliveryBoy &&
        refund.pickup?.deliveryBoy &&
        refund.pickup.deliveryBoy.toString() === deliveryBoy._id.toString()
      ) {
        isAuthorized = true;
      }
    } else if (refund.pickup?.deliveryBoy) {
      deliveryBoy = await DeliveryBoy.findById(refund.pickup.deliveryBoy);
    }

    if (!isAuthorized) {
      return next(new AppError("Unauthorized. You are not the assigned delivery partner for this return pickup.", 403));
    }

    // Verify OTP if required
    if (refund.pickup?.otp) {
      if (!otp || String(otp).trim() !== String(refund.pickup.otp).trim()) {
        return next(new AppError("Invalid pickup verification OTP. Please ask customer for the correct OTP.", 400));
      }
      refund.pickup.isOtpVerified = true;
    }

    const now = new Date();

    // Record inspection report
    refund.inspection = {
      required: true,
      result: result === "PASSED" ? "PASSED" : "FAILED",
      condition,
      missingAccessories,
      visibleDamage,
      quantityCollected: Number(quantityCollected) || 1,
      location,
      proofImages: Array.isArray(proofImages) ? proofImages : [],
      notes,
      inspectedByBoy: deliveryBoy?._id || null,
      inspectedBy: req.user._id,
      inspectedAt: now,
    };

    refund.pickup.status = "RECEIVED_AT_VENDOR";
    refund.pickup.pickedUpAt = now;
    refund.pickup.receivedAt = now;
    refund.status = result === "PASSED" ? "INSPECTED_PASSED" : "INSPECTED_FAILED";

    refund.timeline.push({
      status: refund.status,
      actorRole: "delivery_partner",
      actorName: deliveryBoy?.fullName || req.user.name,
      notes: `Return pickup inspection completed (${result}). Condition: ${condition}. Collected: ${quantityCollected}. Notes: ${notes}`,
      timestamp: now,
    });

    await refund.save();

    // Process Return Pickup Accounting: Deduct NPR 50 from Vendor wallet, Credit NPR 50 to Delivery Boy
    if (deliveryBoy) {
      await processReturnPickupAccounting({
        refundId: refund._id,
        deliveryBoyId: deliveryBoy._id,
        vendorId: refund.vendor._id || refund.vendor,
        pickupCharge: 50,
      });
    }

    // Emit real-time notification to Vendor and Super Admin
    await notifyStaffAdminsForVendor({
      vendorId: refund.vendor._id || refund.vendor,
      eventType: "staff_refund:inspected",
      title: `Return Package Inspected (${result})`,
      message: `Delivery partner submitted return report for #${refund.refundNumber}. Product condition: ${condition}.`,
      data: {
        refundId: refund._id,
        refundNumber: refund.refundNumber,
        result,
        condition,
        proofImages,
      },
    });

    res.status(200).json({
      success: true,
      message: `Return pickup inspection completed successfully. Status: ${refund.status}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

export const approveRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminNotes, customerPayoutDetails } = req.body;

    if (req.user.role === "staffadmin") {
      return next(new AppError("Staff Admins are restricted to read-only monitoring and cannot approve refund claims.", 403));
    }

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

    const isCod = order.paymentMethod === "Cash on delivery" || order.paymentMethod === "COD";

    // Strict authority checks:
    // For COD: Responsible Vendor pays customer directly. Super Admin monitors but does not pay on behalf of vendor.
    if (isCod) {
      const vendor = await Vendor.findOne({ userId: req.user._id });
      if (!vendor || vendor._id.toString() !== refund.vendor.toString()) {
        return next(new AppError("Only the responsible store vendor can approve and refund Cash on Delivery (COD) orders directly.", 403));
      }
    } else {
      // For Online payment: Super Admin processes refund.
      if (req.user.role !== "superadmin") {
        return next(new AppError("Only Super Admin can approve and execute online payment refunds.", 403));
      }
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

    // Customer Notification: Refund Approved
    await notifyCustomerRefundStatusUpdated(freshOrder || order, refund, "APPROVED", adminNotes);

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

      // Customer Notification: Refund Rejected
      await notifyCustomerRefundStatusUpdated(
        updatedOrder,
        refund,
        "REJECTED",
        rejectionReason.trim()
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

    const rawRefunds = await Refund.find(query)
      .populate("order", "orderNumber totalAmount paymentMethod orderStatus codDetails")
      .populate("customer", "name phone email")
      .sort({ createdAt: -1 })
      .lean();

    // Mask sensitive customer payout details and organize into distinct sections
    const maskedRefunds = rawRefunds.map((r) => ({
      ...r,
      customerPayoutDetails: maskCustomerPayoutDetails(r.customerPayoutDetails),
    }));

    const pendingReview = maskedRefunds.filter((r) =>
      ["REQUESTED", "VENDOR_REVIEW", "VENDOR_INFO_REQUIRED"].includes(r.status)
    );
    const approvedObligations = maskedRefunds.filter((r) =>
      ["APPROVED", "STAFF_EXAMINING", "FORWARDED_TO_FINANCE", "RETURN_PICKUP_SCHEDULED", "RETURN_PICKED_UP", "RETURN_RECEIVED", "INSPECTED_PASSED"].includes(r.status)
    );
    const completedVendorRefunds = maskedRefunds.filter((r) =>
      r.status === "COMPLETED"
    );
    const rejectedRefunds = maskedRefunds.filter((r) =>
      ["REJECTED", "VENDOR_REJECTED", "FAILED", "INSPECTED_FAILED"].includes(r.status)
    );

    res.status(200).json({
      success: true,
      count: maskedRefunds.length,
      sections: {
        pendingReview,
        approvedObligations,
        completedVendorRefunds,
        rejectedRefunds,
      },
      data: maskedRefunds,
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

    // Mask sensitive details
    refund.customerPayoutDetails = maskCustomerPayoutDetails(refund.customerPayoutDetails);

    res.status(200).json({
      success: true,
      data: refund,
    });
  } catch (error) {
    next(error);
  }
};

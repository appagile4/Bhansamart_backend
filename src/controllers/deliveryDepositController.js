import crypto from "crypto";
import DeliveryBoy from "../models/DeliveryBoy.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Initiate ₹1,000 Security Deposit Payment
 * POST /api/delivery/deposit/initiate
 */
export const initiateDeposit = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    if (deliveryBoy.securityDeposit?.status === "PAID") {
      return res.status(200).json({
        success: true,
        message: "Security deposit has already been paid.",
        depositStatus: "PAID",
      });
    }

    const gateway = req.body.gateway || "MockGateway";
    const transactionId = `DEP-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const idempotencyKey = `IDEM-DEP-${deliveryBoy._id}-${Date.now()}`;

    // Create a pending ledger transaction entry
    const ledgerEntry = await SecurityDepositLedger.create({
      deliveryBoy: deliveryBoy._id,
      user: req.user._id,
      amount: 1000,
      currency: "INR",
      type: "DEPOSIT_PAYMENT",
      status: "PENDING",
      paymentGateway: gateway,
      transactionId,
      idempotencyKey,
      metadata: {
        initiatedBy: req.user._id,
        partnerPhone: deliveryBoy.phone,
        clientIp: req.ip,
      },
    });

    res.status(200).json({
      success: true,
      message: "Security deposit payment initiated. Complete payment using the gateway reference.",
      amount: 1000,
      currency: "INR",
      transactionId,
      idempotencyKey,
      paymentUrl: `/api/delivery/deposit/webhook?transactionId=${transactionId}`,
      depositStatus: "PENDING",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process Security Deposit Webhook (Idempotent)
 * POST /api/delivery/deposit/webhook
 */
export const handleDepositWebhook = async (req, res, next) => {
  try {
    const { transactionId, gatewayReference, status = "PAID", idempotencyKey } = req.body;

    if (!transactionId) {
      return next(new AppError("Transaction ID is required", 400));
    }

    // Lookup transaction in SecurityDepositLedger
    let ledgerEntry = await SecurityDepositLedger.findOne({ transactionId });
    if (!ledgerEntry) {
      return next(new AppError("Invalid or unknown deposit transaction ID", 404));
    }

    // Idempotency check: if already processed as PAID, return existing record
    if (ledgerEntry.status === "PAID") {
      return res.status(200).json({
        success: true,
        message: "Deposit payment already processed (idempotent response).",
        ledgerEntry,
      });
    }

    if (status === "PAID") {
      ledgerEntry.status = "PAID";
      ledgerEntry.gatewayReference = gatewayReference || `GW-REF-${Date.now()}`;
      ledgerEntry.paidAt = new Date();
      await ledgerEntry.save();

      // Update DeliveryBoy's security deposit status
      await DeliveryBoy.findByIdAndUpdate(ledgerEntry.deliveryBoy, {
        $set: {
          "securityDeposit.status": "PAID",
          "securityDeposit.paidAmount": 1000,
          "securityDeposit.paidAt": new Date(),
          "securityDeposit.transactionId": transactionId,
          "securityDeposit.gateway": ledgerEntry.paymentGateway,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Security deposit verified and marked as PAID successfully.",
        ledgerEntry,
      });
    } else {
      ledgerEntry.status = "FAILED";
      await ledgerEntry.save();

      return res.status(200).json({
        success: false,
        message: "Security deposit payment marked as FAILED.",
        ledgerEntry,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Get Security Deposit Status and History
 * GET /api/delivery/deposit/status
 */
export const getDepositStatus = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const history = await SecurityDepositLedger.find({ deliveryBoy: deliveryBoy._id })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      securityDeposit: deliveryBoy.securityDeposit,
      history,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Request Security Deposit Refund
 * POST /api/delivery/deposit/refund-request
 */
export const requestDepositRefund = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    if (deliveryBoy.securityDeposit?.status !== "PAID") {
      return next(new AppError("Cannot request refund on an unpaid security deposit", 400));
    }

    if (deliveryBoy.activeOrderId) {
      return next(new AppError("Cannot request refund while you have an active order assignment", 400));
    }

    if (deliveryBoy.availability === "ONLINE") {
      return next(new AppError("You must toggle your availability to OFFLINE before requesting a deposit refund", 400));
    }

    const { refundReason = "Voluntary resignation / offboarding" } = req.body;

    deliveryBoy.securityDeposit.status = "REFUND_REQUESTED";
    deliveryBoy.availability = "OFFLINE";
    deliveryBoy.approvalStatus = "SUSPENDED"; // Put in suspended state while refund is processed
    await deliveryBoy.save();

    // Log in SecurityDepositLedger
    const refundTxId = `REF-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const ledgerEntry = await SecurityDepositLedger.create({
      deliveryBoy: deliveryBoy._id,
      user: req.user._id,
      amount: 1000,
      currency: "INR",
      type: "DEPOSIT_REFUND",
      status: "REFUND_REQUESTED",
      transactionId: refundTxId,
      refundReason,
    });

    res.status(200).json({
      success: true,
      message: "Security deposit refund request submitted for admin review.",
      status: "REFUND_REQUESTED",
      transactionId: refundTxId,
    });
  } catch (error) {
    next(error);
  }
};

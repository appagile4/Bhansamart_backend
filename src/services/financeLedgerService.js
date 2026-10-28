import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import VendorTransaction from "../models/VendorTransaction.js";
import CodHandover from "../models/CodHandover.js";
import Refund from "../models/Refund.js";
import Product from "../models/Product.js";
import VendorNotification from "../models/VendorNotification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  FINANCE_CONFIG,
  calculateCommission,
  calculateRefundReversal,
} from "../config/financeConfig.js";
import {
  emitVendorNotification,
  emitVendorWalletUpdate,
  emitVendorCodUpdate,
  emitOrderStatusUpdate,
} from "../socket/socketManager.js";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. ONLINE PAYMENT CAPTURE & SETTLEMENT
 * Only called after authenticated gateway capture / webhook confirmation.
 * Calculates 1.5% fixed superadmin commission and credits vendor.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function recordOnlineOrderPayment(order, {
  gatewayTransactionId = "",
  paymentProvider = "Online Payment",
  rawGatewayResponse = null,
} = {}) {
  const onlineTxnKey = `TXN-ORD-${order._id}`;

  // Idempotency check: prevent duplicate credit on webhook retries
  const existingTxn = await VendorTransaction.findOne({ idempotencyKey: onlineTxnKey });
  if (existingTxn) {
    return {
      success: true,
      alreadyProcessed: true,
      transaction: existingTxn,
    };
  }

  const vendor = await Vendor.findById(order.vendor?._id || order.vendor);
  if (!vendor) {
    throw new AppError("Vendor not found for order", 404);
  }

  if (!vendor.wallet) {
    vendor.wallet = {
      currentBalance: 0,
      totalEarned: 0,
      pendingSettlement: 0,
      codCashWithDeliveryBoys: 0,
      pendingRecoveries: 0,
    };
  }

  // Base for commission: Product items total or totalAmount
  const grossAmount = Number(order.totalAmount || order.itemsTotal || 0);
  const { commission, netAmount, rate } = calculateCommission(
    grossAmount,
    FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE
  );

  // Update order financial tracking
  order.paymentStatus = "paid";
  order.paymentDetails = {
    gatewayTransactionId: gatewayTransactionId || order.orderNumber,
    paymentProvider,
    verifiedAt: new Date(),
    rawGatewayResponse,
  };
  order.financialLedger = {
    eligibleAmount: grossAmount,
    commissionRate: rate,
    commissionAmount: commission,
    vendorNetAmount: netAmount,
    settlementStatus: "SETTLED",
    settledAt: new Date(),
  };
  await order.save();

  // Handle recovery adjustments if vendor has pending recoveries from previous refunds
  let netToCredit = netAmount;
  let recoveryDeduction = 0;

  if (vendor.wallet.pendingRecoveries && vendor.wallet.pendingRecoveries > 0) {
    recoveryDeduction = Math.min(vendor.wallet.pendingRecoveries, netAmount);
    vendor.wallet.pendingRecoveries = Math.max(
      0,
      vendor.wallet.pendingRecoveries - recoveryDeduction
    );
    netToCredit = netAmount - recoveryDeduction;

    // Record recovery adjustment transaction
    await VendorTransaction.create({
      vendor: vendor._id,
      order: order._id,
      type: "RECOVERY_ADJUSTMENT",
      amount: recoveryDeduction,
      grossAmount,
      commission: 0,
      netAmount: -recoveryDeduction,
      paymentMethod: paymentProvider,
      status: "RECOVERED",
      idempotencyKey: `TXN-RECOVERY-${order._id}`,
      notes: `Automatic recovery of NPR ${recoveryDeduction} offset against Order #${order.orderNumber} earnings.`,
    });
  }

  // Credit vendor wallet
  vendor.wallet.currentBalance = Math.round(((vendor.wallet.currentBalance || 0) + netToCredit) * 100) / 100;
  vendor.wallet.totalEarned = Math.round(((vendor.wallet.totalEarned || 0) + netAmount) * 100) / 100;
  await vendor.save();

  // Create immutable financial transaction
  const transaction = await VendorTransaction.create({
    vendor: vendor._id,
    order: order._id,
    type: "ORDER_EARNING",
    amount: netAmount,
    grossAmount,
    commission,
    commissionRate: rate,
    commissionBase: grossAmount,
    netAmount,
    paymentMethod: paymentProvider,
    status: "SETTLED",
    idempotencyKey: onlineTxnKey,
    notes: `Online order payout for Order #${order.orderNumber} (Gross: NPR ${grossAmount}, Commission 1.5%: NPR ${commission}, Net: NPR ${netAmount}).`,
  });

  // Persistent Notification
  const vendorNotif = await VendorNotification.create({
    vendor: vendor._id,
    order: order._id,
    type: "PAYMENT_RECEIVED",
    title: "Order Payment Verified & Settled",
    message: `Payment of NPR ${grossAmount} confirmed for Order #${order.orderNumber}. Net NPR ${netAmount} credited after 1.5% commission (NPR ${commission}).`,
    data: {
      orderNumber: order.orderNumber,
      grossAmount,
      commission,
      netAmount,
      currentBalance: vendor.wallet.currentBalance,
    },
  });

  emitVendorNotification(vendor._id.toString(), vendorNotif);
  emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);

  return {
    success: true,
    alreadyProcessed: false,
    grossAmount,
    commission,
    netAmount,
    transaction,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. COD DOORSTEP CASH / UPI COLLECTION ACCOUNTING
 * Called when delivery boy verifies customer delivery OTP.
 * Handles both physical Cash custody and Direct Store QR / UPI payment.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function recordCodDoorstepCollection(order, deliveryBoy, {
  paymentMode = "CASH",
  collectedAmount = null,
  discrepancyReason = "",
  now = new Date(),
} = {}) {
  const vendor = await Vendor.findById(order.vendor?._id || order.vendor);
  if (!vendor) {
    throw new AppError("Vendor not found for order", 404);
  }

  if (!vendor.wallet) {
    vendor.wallet = {
      currentBalance: 0,
      totalEarned: 0,
      pendingSettlement: 0,
      codCashWithDeliveryBoys: 0,
      pendingRecoveries: 0,
    };
  }

  const grossAmount = Number(order.totalAmount || order.itemsTotal || 0);
  const actualCollected = collectedAmount !== null ? Number(collectedAmount) : grossAmount;
  const hasShortfall = actualCollected !== grossAmount;
  const shortfallAmount = hasShortfall ? Math.max(0, Math.round((grossAmount - actualCollected) * 100) / 100) : 0;

  // ── Case B: Customer pays via Direct Store QR / UPI at customer doorstep ──
  if (paymentMode === "DIRECT_QR" || paymentMode === "ONLINE") {
    order.paymentStatus = "paid";
    order.paymentMethod = "Vendor QR Code (Direct)";
    order.codDetails = {
      status: "VENDOR_CONFIRMED",
      amountDue: grossAmount,
      amountCollected: grossAmount,
      cashCollectedByRider: false,
      cashCollectedAmount: 0,
      cashCollectedAt: null,
      amountHandedOver: grossAmount,
      cashSubmittedToVendor: true,
      cashSubmittedAt: now,
      vendorConfirmed: true,
      vendorConfirmedAt: now,
      vendorConfirmedBy: vendor.userId || null,
      handoverReceipt: "DIRECT_QR_PAID",
      isDirectVendorQrPaid: true,
      directQrPaidAt: now,
      discrepancy: {
        hasDiscrepancy: false,
        expectedAmount: grossAmount,
        actualAmount: grossAmount,
        shortfall: 0,
        reason: "",
        reportedAt: null,
        reportedBy: null,
        reportedByRole: "",
      },
      auditHistory: [
        {
          action: "DIRECT_QR_PAID",
          performedBy: deliveryBoy.user,
          performedByRole: "delivery_boy",
          notes: `Customer paid NPR ${grossAmount} directly via store QR at doorstep.`,
          previousStatus: "COD_PENDING",
          newStatus: "VENDOR_CONFIRMED",
          timestamp: now,
        },
      ],
    };
    order.financialLedger = {
      eligibleAmount: grossAmount,
      commissionRate: 0,
      commissionAmount: 0,
      vendorNetAmount: grossAmount,
      settlementStatus: "SETTLED",
      settledAt: now,
    };
    await order.save();

    // Vendor received physical/direct payment. No duplicate digital wallet credit.
    vendor.wallet.totalEarned = Math.round(((vendor.wallet.totalEarned || 0) + grossAmount) * 100) / 100;
    await vendor.save();

    // Idempotent Transaction for Direct QR sale
    const directQrTxnKey = `TXN-DIRECT-QR-${order._id}`;
    const existingTxn = await VendorTransaction.findOne({ idempotencyKey: directQrTxnKey });
    if (!existingTxn) {
      await VendorTransaction.create({
        vendor: vendor._id,
        order: order._id,
        deliveryBoy: deliveryBoy._id,
        type: "DIRECT_QR_PAYMENT",
        amount: grossAmount,
        grossAmount,
        commission: 0,
        commissionRate: 0,
        commissionBase: grossAmount,
        netAmount: 0, // No digital wallet credit
        paymentMethod: "Vendor QR Code (Direct)",
        status: "DIRECT_SETTLED",
        idempotencyKey: directQrTxnKey,
        notes: `Direct UPI/QR payment of NPR ${grossAmount} received by vendor store account at customer doorstep via ${deliveryBoy.fullName}.`,
      });
    }

    // Persistent notification
    const vendorNotif = await VendorNotification.create({
      vendor: vendor._id,
      order: order._id,
      type: "PAYMENT_RECEIVED",
      title: "Direct QR Payment Received",
      message: `Customer paid NPR ${grossAmount} directly to your Store QR/UPI for Order #${order.orderNumber}.`,
      data: {
        orderNumber: order.orderNumber,
        grossAmount,
        deliveryBoyName: deliveryBoy.fullName,
        paymentMethod: "Vendor QR Code (Direct)",
      },
    });

    emitVendorNotification(vendor._id.toString(), vendorNotif);
    emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);

    return {
      mode: "DIRECT_QR",
      grossAmount,
      commission: 0,
      netAmount: grossAmount,
    };
  }

  // ── Case A: Customer pays Cash to delivery boy ────────────────────────
  const codStatus = hasShortfall ? "DISCREPANCY_REPORTED" : "CASH_COLLECTED";
  order.paymentStatus = "paid";
  order.codDetails = {
    status: codStatus,
    amountDue: grossAmount,
    amountCollected: actualCollected,
    cashCollectedByRider: true,
    cashCollectedAmount: actualCollected,
    cashCollectedAt: now,
    amountHandedOver: 0,
    cashSubmittedToVendor: false,
    cashSubmittedAt: null,
    vendorConfirmed: false,
    vendorConfirmedAt: null,
    vendorConfirmedBy: null,
    handoverReceipt: "",
    isDirectVendorQrPaid: false,
    directQrPaidAt: null,
    discrepancy: {
      hasDiscrepancy: hasShortfall,
      expectedAmount: grossAmount,
      actualAmount: actualCollected,
      shortfall: shortfallAmount,
      reason: discrepancyReason || (hasShortfall ? `Shortfall of NPR ${shortfallAmount} at doorstep collection` : ""),
      reportedAt: hasShortfall ? now : null,
      reportedBy: deliveryBoy.user,
      reportedByRole: "delivery_boy",
    },
    auditHistory: [
      {
        action: hasShortfall ? "COD_COLLECTION_DISCREPANCY" : "CASH_COLLECTED",
        performedBy: deliveryBoy.user,
        performedByRole: "delivery_boy",
        notes: hasShortfall
          ? `Cash shortfall reported: Expected NPR ${grossAmount}, Collected NPR ${actualCollected}. Reason: ${discrepancyReason || "Mismatch at doorstep"}`
          : `Physical cash of NPR ${grossAmount} collected at customer doorstep.`,
        previousStatus: "COD_PENDING",
        newStatus: codStatus,
        timestamp: now,
      },
    ],
  };

  order.financialLedger = {
    eligibleAmount: grossAmount,
    commissionRate: 0,
    commissionAmount: 0,
    vendorNetAmount: grossAmount,
    settlementStatus: "COD_IN_CUSTODY",
    settledAt: null,
  };
  await order.save();

  // Increment delivery boy's physical cash custody by actual cash collected
  deliveryBoy.codCashInCustody = Math.round(((deliveryBoy.codCashInCustody || 0) + actualCollected) * 100) / 100;
  await deliveryBoy.save();

  // Increment Vendor's COD custody tracker (NOT credited to digital wallet balance)
  vendor.wallet.codCashWithDeliveryBoys =
    Math.round(((vendor.wallet.codCashWithDeliveryBoys || 0) + actualCollected) * 100) / 100;
  await vendor.save();

  // Idempotent Transaction for COD Collection (informational only; netAmount: 0)
  const codTxnKey = `TXN-COD-COLL-${order._id}`;
  const existingTxn = await VendorTransaction.findOne({ idempotencyKey: codTxnKey });
  if (!existingTxn) {
    await VendorTransaction.create({
      vendor: vendor._id,
      order: order._id,
      deliveryBoy: deliveryBoy._id,
      type: "COD_COLLECTION",
      amount: actualCollected,
      grossAmount,
      commission: 0,
      commissionRate: 0,
      commissionBase: grossAmount,
      netAmount: 0, // Physical cash, not digital wallet balance
      paymentMethod: "Cash on delivery",
      status: hasShortfall ? "DISCREPANCY_REPORTED" : "CASH_IN_CUSTODY",
      idempotencyKey: codTxnKey,
      notes: hasShortfall
        ? `Cash shortfall reported: Expected NPR ${grossAmount}, Collected NPR ${actualCollected} by ${deliveryBoy.fullName} for Order #${order.orderNumber}.`
        : `Cash of NPR ${grossAmount} collected by ${deliveryBoy.fullName} for Order #${order.orderNumber}. Handover pending at store counter.`,
    });
  }

  // Persistent Notification
  const vendorNotif = await VendorNotification.create({
    vendor: vendor._id,
    order: order._id,
    type: hasShortfall ? "COD_DISCREPANCY" : "COD_COLLECTED",
    title: hasShortfall ? "⚠️ COD Collection Discrepancy" : "COD Cash Collected by Partner",
    message: hasShortfall
      ? `Delivery partner ${deliveryBoy.fullName} collected NPR ${actualCollected} (Shortfall of NPR ${shortfallAmount}) for Order #${order.orderNumber}. Reason: ${discrepancyReason || "Mismatch"}`
      : `Delivery partner ${deliveryBoy.fullName} collected NPR ${grossAmount} for Order #${order.orderNumber}. Cash handover pending at your store.`,
    data: {
      orderNumber: order.orderNumber,
      totalAmount: grossAmount,
      actualCollected,
      shortfall: shortfallAmount,
      hasShortfall,
      deliveryBoyName: deliveryBoy.fullName,
    },
  });

  emitVendorNotification(vendor._id.toString(), vendorNotif);
  emitVendorCodUpdate(vendor._id.toString(), {
    orderId: order._id,
    orderNumber: order.orderNumber,
    collectedAmount: actualCollected,
    codCashWithDeliveryBoys: vendor.wallet.codCashWithDeliveryBoys,
    hasDiscrepancy: hasShortfall,
    shortfall: shortfallAmount,
  });

  return {
    mode: "CASH",
    grossAmount,
    actualCollected,
    hasShortfall,
    shortfall: shortfallAmount,
    commission: 0,
    netAmount: grossAmount,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. COD CASH SUBMISSION AT VENDOR STORE RECONCILIATION
 * CRITICAL RULE: Cash submission clears the custody obligation.
 * It DOES NOT credit the vendor's wallet with duplicate sales earnings.
 * SuperAdmin does NOT receive any commission on COD orders (0% platform commission).
 * Vendor retains 100% of the physical COD cash received.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function recordCodCashSubmission(vendor, deliveryBoy, {
  amountSubmitted,
  totalDue,
  eligibleOrders,
  receiptNumber,
  paymentMode = "CASH",
  notes = "",
  confirmedBy = null,
  discrepancyReason = "",
} = {}) {
  const submitted = Number(amountSubmitted);
  const hasShortfall = submitted < totalDue;
  const shortfallAmount = hasShortfall ? Math.max(0, Math.round((totalDue - submitted) * 100) / 100) : 0;

  // Update delivery partner cash custody
  deliveryBoy.codCashInCustody = Math.max(
    0,
    Math.round(((deliveryBoy.codCashInCustody || 0) - submitted) * 100) / 100
  );
  await deliveryBoy.save();

  // Update vendor custody tracker
  vendor.wallet.codCashWithDeliveryBoys = Math.max(
    0,
    Math.round(((vendor.wallet.codCashWithDeliveryBoys || 0) - submitted) * 100) / 100
  );

  // Mark orders as submitted and track individual handover allocations
  let remainingToAllocate = submitted;
  const settledOrderIds = [];

  for (const ord of eligibleOrders) {
    const ordAmt = ord.codDetails?.cashCollectedAmount || ord.totalAmount || 0;
    const allocatedForThis = Math.min(ordAmt, remainingToAllocate);
    const ordHasShortfall = allocatedForThis < ordAmt;

    ord.codDetails.status = ordHasShortfall ? "DISCREPANCY_REPORTED" : "VENDOR_CONFIRMED";
    ord.codDetails.cashSubmittedToVendor = true;
    ord.codDetails.cashSubmittedAt = new Date();
    ord.codDetails.vendorConfirmed = true;
    ord.codDetails.vendorConfirmedAt = new Date();
    ord.codDetails.vendorConfirmedBy = confirmedBy || vendor.userId || null;
    ord.codDetails.amountHandedOver = allocatedForThis;
    ord.codDetails.handoverReceipt = receiptNumber;

    if (ordHasShortfall) {
      ord.codDetails.discrepancy = {
        hasDiscrepancy: true,
        expectedAmount: ordAmt,
        actualAmount: allocatedForThis,
        shortfall: ordAmt - allocatedForThis,
        reason: discrepancyReason || notes || "Handover shortfall at vendor store",
        reportedAt: new Date(),
        reportedBy: confirmedBy || vendor.userId || null,
        reportedByRole: "vendor",
      };
    }

    if (!ord.codDetails.auditHistory) ord.codDetails.auditHistory = [];
    ord.codDetails.auditHistory.push({
      action: ordHasShortfall ? "COD_HANDOVER_DISCREPANCY" : "VENDOR_HANDOVER_CONFIRMED",
      performedBy: confirmedBy || vendor.userId || null,
      performedByRole: "vendor",
      notes: ordHasShortfall
        ? `Vendor confirmed cash handover with shortfall. Handed over: NPR ${allocatedForThis}, Expected: NPR ${ordAmt}.`
        : `Vendor confirmed physical cash receipt of NPR ${ordAmt} at store counter.`,
      previousStatus: "CASH_COLLECTED",
      newStatus: ord.codDetails.status,
      timestamp: new Date(),
    });

    if (ord.financialLedger) {
      ord.financialLedger.settlementStatus = "COD_SUBMITTED";
      ord.financialLedger.settledAt = new Date();
      ord.financialLedger.commissionRate = 0;
      ord.financialLedger.commissionAmount = 0;
      ord.financialLedger.vendorNetAmount = ord.totalAmount || ord.itemsTotal || 0;
    }
    await ord.save();
    settledOrderIds.push(ord._id);
    remainingToAllocate = Math.max(0, remainingToAllocate - ordAmt);
  }

  // Update cumulative revenue earned without debiting/crediting digital wallet balance
  vendor.wallet.totalEarned = Math.round(((vendor.wallet.totalEarned || 0) + submitted) * 100) / 100;
  await vendor.save();

  // 1. Create CodHandover document
  const handover = await CodHandover.create({
    receiptNumber,
    vendor: vendor._id,
    deliveryBoy: deliveryBoy._id,
    orders: settledOrderIds,
    amountDue: totalDue,
    amountSubmitted: submitted,
    remainingBalance: shortfallAmount,
    vendorConfirmed: true,
    confirmedBy: confirmedBy || vendor.userId || null,
    status: hasShortfall ? "DISCREPANCY_REPORTED" : "VENDOR_CONFIRMED",
    discrepancy: {
      hasDiscrepancy: hasShortfall,
      expectedAmount: totalDue,
      submittedAmount: submitted,
      shortfall: shortfallAmount,
      reason: discrepancyReason || notes || "",
      reportedAt: hasShortfall ? new Date() : null,
      reportedBy: confirmedBy || vendor.userId || null,
    },
    paymentMode,
    notes: notes || `Cash verified and received at store counter by ${vendor.businessDetails?.businessName || "Vendor"}`,
    auditHistory: [
      {
        action: hasShortfall ? "HANDOVER_DISCREPANCY_REPORTED" : "VENDOR_CONFIRMED",
        performedBy: confirmedBy || vendor.userId || null,
        role: "vendor",
        notes: hasShortfall
          ? `Shortfall of NPR ${shortfallAmount} reported upon cash handover.`
          : `Handover of NPR ${submitted} fully verified.`,
        timestamp: new Date(),
      },
    ],
  });

  // 2. Create VendorTransaction for COD Handover (informational settlement record; netAmount: 0)
  await VendorTransaction.create({
    vendor: vendor._id,
    deliveryBoy: deliveryBoy._id,
    type: "COD_HANDOVER",
    amount: submitted,
    grossAmount: submitted,
    commission: 0,
    commissionRate: 0,
    commissionBase: submitted,
    netAmount: 0, // Physical cash received directly at store; digital wallet balance is unchanged
    paymentMethod: paymentMode,
    status: "SETTLED",
    idempotencyKey: `TXN-HANDOVER-${receiptNumber}`,
    notes: `Physical COD cash handover of NPR ${submitted} confirmed at store counter (No digital wallet debit/credit). Receipt #${receiptNumber}.`,
  });

  // 3. Persistent Notifications
  const vendorNotif = await VendorNotification.create({
    vendor: vendor._id,
    type: hasShortfall ? "COD_DISCREPANCY" : "COD_SUBMITTED",
    title: hasShortfall ? "⚠️ COD Handover Shortfall Recorded" : "COD Cash Handover Confirmed",
    message: hasShortfall
      ? `Handover confirmed with shortfall: Received NPR ${submitted} out of NPR ${totalDue} from ${deliveryBoy.fullName}. Shortfall: NPR ${shortfallAmount}. Receipt #${receiptNumber}.`
      : `Received and confirmed physical cash of NPR ${submitted} from ${deliveryBoy.fullName}. Receipt #${receiptNumber}.`,
    data: {
      receiptNumber,
      amountSubmitted: submitted,
      totalDue,
      shortfall: shortfallAmount,
      hasShortfall,
      deliveryBoyName: deliveryBoy.fullName,
      remainingRiderCustody: deliveryBoy.codCashInCustody,
    },
  });

  emitVendorNotification(vendor._id.toString(), vendorNotif);
  emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);
  emitVendorCodUpdate(vendor._id.toString(), {
    receiptNumber,
    submittedAmount: submitted,
    totalDue,
    remainingCustodyWithRider: deliveryBoy.codCashInCustody,
    hasDiscrepancy: hasShortfall,
    shortfall: shortfallAmount,
  });

  return {
    success: true,
    receiptNumber,
    amountSubmitted: submitted,
    totalDue,
    hasShortfall,
    shortfall: shortfallAmount,
    totalCommissionDue: 0,
    handover,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. REFUND, CANCELLATION, RETURN & REPLACEMENT PROCESSING
 * Handles:
 * - Order cancellation before dispatch (full refund / no charge for uncollected COD)
 * - Returns, damaged goods, wrong item claims after delivery
 * - 1.5% commission reversal on refunded amounts
 * - Vendor recovery handling when vendor has already withdrawn funds
 * - Zero second customer charge for replacements
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function processOrderRefund(arg1 = {}, arg2 = {}) {
  // Support both processOrderRefund({ order, ... }) and processOrderRefund(order, { ... })
  const params = arg1 && arg1._id ? { order: arg1, ...arg2 } : arg1;
  const {
    order,
    items = [],
    refundAmount,
    reason = "Customer cancellation / return",
    description = "",
    proofImages = [],
    claimType = "CANCELLATION",
    customerPayoutDetails = {},
    reviewedBy = null,
    idempotencyKey,
  } = params;

  if (!order || !order._id) {
    throw new AppError("Order object is required to process refund", 400);
  }

  // Idempotency check: prevent duplicate refunds
  const dedupeKey = idempotencyKey || `REFUND-${order._id}-${Date.now()}`;
  const existingRefund = await Refund.findOne({ idempotencyKey: dedupeKey });
  if (existingRefund) {
    return {
      success: true,
      alreadyProcessed: true,
      refund: existingRefund,
    };
  }

  let requestedAmount = Number(refundAmount);
  if (isNaN(requestedAmount) || requestedAmount <= 0) {
    if (items && items.length > 0) {
      requestedAmount = items.reduce(
        (sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 1)),
        0
      );
    }
  }
  if (!requestedAmount || requestedAmount <= 0) {
    requestedAmount = Number(order.totalAmount);
  }
  if (requestedAmount <= 0) {
    throw new AppError("Refund amount must be greater than zero", 400);
  }

  if (requestedAmount > order.totalAmount) {
    throw new AppError(
      `Refund amount (NPR ${requestedAmount}) cannot exceed order total (NPR ${order.totalAmount})`,
      400
    );
  }

  // ── Verification: Did the customer actually pay? ──
  const isPaid = order.paymentStatus === "paid";
  const isCod = order.paymentMethod === "Cash on delivery";
  const wasCashCollected = Boolean(order.codDetails?.cashCollectedByRider);

  // If COD and no cash was ever collected, no financial payout is made to customer!
  const requiresFinancialPayout = isPaid && (!isCod || wasCashCollected);

  // Generate unique refund number
  const refundNumber = await Refund.generateRefundNumber();

  // Calculate pro-rata commission reversal
  const { vendorDeduction, commissionReversal } = calculateRefundReversal(
    requestedAmount,
    FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE
  );

  const vendor = await Vendor.findById(order.vendor?._id || order.vendor);
  if (vendor && !vendor.wallet) {
    vendor.wallet = {
      currentBalance: 0,
      totalEarned: 0,
      pendingSettlement: 0,
      codCashWithDeliveryBoys: 0,
      pendingRecoveries: 0,
    };
  }

  // ── Handle financial adjustments only if customer actually paid ──
  if (requiresFinancialPayout && vendor) {
    if (isCod) {
      // ── VENDOR-FUNDED COD REFUND ──
      // The vendor physically collected the COD cash. The vendor directly pays the customer.
      // Super Admin and Vendor digital wallets are NOT debited.
      await VendorTransaction.create({
        vendor: vendor._id,
        order: order._id,
        type: "VENDOR_DIRECT_REFUND",
        amount: requestedAmount,
        grossAmount: requestedAmount,
        commission: 0,
        commissionRate: 0,
        commissionBase: requestedAmount,
        netAmount: 0, // Direct vendor payout to customer, no digital wallet deduction
        paymentMethod: "Cash on delivery",
        status: "COMPLETED",
        idempotencyKey: `REF-VEND-DIRECT-${dedupeKey}`,
        notes: `Vendor-funded COD direct customer refund of NPR ${requestedAmount} for Order #${order.orderNumber} (Reason: ${reason}).`,
      });
    } else {
      // ── ONLINE ORDER REFUND ──
      // If vendor has enough available balance:
      if ((vendor.wallet.currentBalance || 0) >= vendorDeduction) {
        vendor.wallet.currentBalance = Math.round((vendor.wallet.currentBalance - vendorDeduction) * 100) / 100;
      } else {
        // Vendor has already withdrawn funds:
        // Deduct all remaining available balance, and record the deficit in pendingRecoveries
        const deficit = Math.round((vendorDeduction - (vendor.wallet.currentBalance || 0)) * 100) / 100;
        vendor.wallet.currentBalance = 0;
        vendor.wallet.pendingRecoveries = Math.round(((vendor.wallet.pendingRecoveries || 0) + deficit) * 100) / 100;
      }

      // Decrement cumulative sales earned
      vendor.wallet.totalEarned = Math.max(
        0,
        Math.round(((vendor.wallet.totalEarned || 0) - vendorDeduction) * 100) / 100
      );
      await vendor.save();

      // 1. Record VendorTransaction for Vendor Earning Reversal
      await VendorTransaction.create({
        vendor: vendor._id,
        order: order._id,
        type: "REFUND_DEDUCTION",
        amount: vendorDeduction,
        grossAmount: requestedAmount,
        commission: commissionReversal,
        commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
        commissionBase: requestedAmount,
        netAmount: -vendorDeduction,
        paymentMethod: order.paymentMethod,
        status: "SETTLED",
        idempotencyKey: `REF-VEND-DED-${dedupeKey}`,
        notes: `Refund #${refundNumber} deduction of NPR ${vendorDeduction} for Order #${order.orderNumber} (Reason: ${reason}).`,
      });

      // 2. Record VendorTransaction for 1.5% Superadmin Commission Reversal
      await VendorTransaction.create({
        vendor: vendor._id,
        order: order._id,
        type: "COMMISSION_REVERSAL",
        amount: commissionReversal,
        grossAmount: requestedAmount,
        commission: -commissionReversal,
        commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
        commissionBase: requestedAmount,
        netAmount: commissionReversal,
        paymentMethod: order.paymentMethod,
        status: "REVERSED",
        idempotencyKey: `REF-COMM-REV-${dedupeKey}`,
        notes: `Platform 1.5% commission reversal of NPR ${commissionReversal} for Refund #${refundNumber}.`,
      });
    }
  }

  // ── Restore Product Inventory ──
  const itemsToRestore = items.length > 0 ? items : order.items;
  for (const item of itemsToRestore) {
    if (item.product || item.productId) {
      await Product.findByIdAndUpdate(item.product || item.productId, {
        $inc: { stock: item.quantity, ordersCount: -item.quantity },
      }).catch(() => {});
    }
  }

  // ── Update Order Status & Financial Tracking ──
  const isFullRefund = requestedAmount >= order.totalAmount;
  if (isFullRefund) {
    order.orderStatus = "CANCELLED";
    order.paymentStatus = requiresFinancialPayout ? "refunded" : "failed";
    order.refundStatus = claimType === "REPLACEMENT" ? "REPLACED" : "REFUNDED";
  } else {
    order.paymentStatus = "partially_refunded";
    order.refundStatus = "PARTIAL_REFUNDED";
  }

  order.statusHistory.push({
    status: isFullRefund ? "CANCELLED" : "PARTIAL_REFUNDED",
    timestamp: new Date(),
    updatedBy: reviewedBy || order.customer,
    reason: `Refund #${refundNumber}: ${reason}`,
  });
  await order.save();

  // ── Create Persistent Refund Record ──
  const refundRecord = await Refund.create({
    refundNumber,
    order: order._id,
    orderNumber: order.orderNumber,
    customer: order.customer,
    vendor: order.vendor?._id || order.vendor,
    claimType,
    items: itemsToRestore.map((i) => ({
      product: i.product || i.productId,
      productId: (i.product || i.productId).toString(),
      name: i.name || "Item",
      price: i.price,
      quantity: i.quantity,
      imageUrl: i.imageUrl || "",
    })),
    amount: requestedAmount,
    originalPaymentMethod: order.paymentMethod,
    vendorDeduction: requiresFinancialPayout ? vendorDeduction : 0,
    commissionReversal: requiresFinancialPayout ? commissionReversal : 0,
    commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
    reason,
    description,
    proofImages,
    status: "COMPLETED",
    isVendorFunded: isCod,
    gatewayRefundId: customerPayoutDetails.payoutReference || `REF-GTW-${Date.now()}`,
    customerPayoutDetails: {
      method: customerPayoutDetails.method || (isCod ? "UPI" : "GATEWAY_REVERSAL"),
      upiId: customerPayoutDetails.upiId || "",
      accountNumber: customerPayoutDetails.accountNumber || "",
      bankName: customerPayoutDetails.bankName || "",
      accountHolderName: customerPayoutDetails.accountHolderName || "",
      payoutReference: customerPayoutDetails.payoutReference || `TXN-REF-${Date.now()}`,
      payoutCompletedAt: new Date(),
    },
    reviewedBy,
    reviewedAt: new Date(),
    idempotencyKey: dedupeKey,
  });

  // ── Handle Replacement Order (Zero customer charge, zero duplicate sales) ──
  let replacementOrder = null;
  if (claimType === "REPLACEMENT") {
    const replacementOrderNumber = await Order.generateOrderNumber();
    replacementOrder = await Order.create({
      orderNumber: `${replacementOrderNumber}-REP`,
      idempotencyKey: `REP-ORD-${order._id}-${Date.now()}`,
      customer: order.customer,
      vendor: order.vendor?._id || order.vendor,
      items: itemsToRestore,
      totalCount: itemsToRestore.reduce((s, i) => s + (i.quantity || 1), 0),
      itemsTotal: 0, // No second charge to customer
      handlingCharge: 0,
      deliveryCharge: 0,
      discount: 0,
      totalAmount: 0,
      deliveryAddress: order.deliveryAddress,
      paymentMethod: "Replacement (No Charge)",
      paymentStatus: "paid",
      orderStatus: "PLACED",
      statusHistory: [
        {
          status: "PLACED",
          timestamp: new Date(),
          updatedBy: reviewedBy || order.customer,
          reason: `Replacement order for original #${order.orderNumber} (Claim: ${refundNumber})`,
        },
      ],
      estimatedDeliveryTime: "Same Day / Express",
    });

    refundRecord.replacementOrder = replacementOrder._id;
    await refundRecord.save();
  }

  // ── Notifications & Socket Broadcasting ──
  if (vendor) {
    const vendorNotif = await VendorNotification.create({
      vendor: vendor._id,
      order: order._id,
      type: "REFUND_PROCESSED",
      title: `Order ${claimType === "REPLACEMENT" ? "Replacement" : "Refund"} #${refundNumber}`,
      message: `Refund of NPR ${requestedAmount} processed for Order #${order.orderNumber}. Vendor deduction: NPR ${vendorDeduction}. Commission reversed: NPR ${commissionReversal}.`,
      data: {
        refundNumber,
        orderNumber: order.orderNumber,
        refundAmount: requestedAmount,
        vendorDeduction,
        commissionReversal,
        currentBalance: vendor.wallet?.currentBalance || 0,
        pendingRecoveries: vendor.wallet?.pendingRecoveries || 0,
      },
    });

    emitVendorNotification(vendor._id.toString(), vendorNotif);
    emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);
  }

  // Real-time update to customer
  emitOrderStatusUpdate(
    order._id.toString(),
    order.customer?.toString(),
    order
  );

  return {
    success: true,
    alreadyProcessed: false,
    refund: refundRecord,
    amount: requestedAmount,
    refundAmount: requestedAmount,
    vendorDeduction,
    commissionReversal,
    commissionReversed: commissionReversal,
    replacementOrder,
  };
}

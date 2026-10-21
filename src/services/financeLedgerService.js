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
  const { commission, netAmount, rate } = calculateCommission(
    grossAmount,
    FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE
  );

  // ── Case B: Customer pays via Direct Store QR / UPI at customer doorstep ──
  if (paymentMode === "DIRECT_QR" || paymentMode === "ONLINE") {
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
    order.financialLedger = {
      eligibleAmount: grossAmount,
      commissionRate: rate,
      commissionAmount: commission,
      vendorNetAmount: netAmount,
      settlementStatus: "SETTLED",
      settledAt: now,
    };
    await order.save();

    // Vendor received entire grossAmount directly into their store UPI bank account.
    // The 1.5% platform commission (NPR commission) is owed by vendor to platform.
    if ((vendor.wallet.currentBalance || 0) >= commission) {
      vendor.wallet.currentBalance = Math.round((vendor.wallet.currentBalance - commission) * 100) / 100;
    } else {
      const remainingComm = Math.round((commission - (vendor.wallet.currentBalance || 0)) * 100) / 100;
      vendor.wallet.currentBalance = 0;
      vendor.wallet.pendingRecoveries = Math.round(((vendor.wallet.pendingRecoveries || 0) + remainingComm) * 100) / 100;
    }
    vendor.wallet.totalEarned = Math.round(((vendor.wallet.totalEarned || 0) + netAmount) * 100) / 100;
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
        commission,
        commissionRate: rate,
        commissionBase: grossAmount,
        netAmount,
        paymentMethod: "Vendor QR Code (Direct)",
        status: "DIRECT_SETTLED",
        idempotencyKey: directQrTxnKey,
        notes: `Direct UPI/QR payment of NPR ${grossAmount} received by vendor store account at customer doorstep via ${deliveryBoy.fullName}. Commission of NPR ${commission} (1.5%) deducted from platform balance.`,
      });
    }

    // Persistent notification
    const vendorNotif = await VendorNotification.create({
      vendor: vendor._id,
      order: order._id,
      type: "PAYMENT_RECEIVED",
      title: "Direct QR Payment Received",
      message: `Customer paid NPR ${grossAmount} directly to your Store QR/UPI for Order #${order.orderNumber}. 1.5% Platform commission: NPR ${commission}.`,
      data: {
        orderNumber: order.orderNumber,
        grossAmount,
        commission,
        netAmount,
        deliveryBoyName: deliveryBoy.fullName,
        paymentMethod: "Vendor QR Code (Direct)",
      },
    });

    emitVendorNotification(vendor._id.toString(), vendorNotif);
    emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);

    return {
      mode: "DIRECT_QR",
      grossAmount,
      commission,
      netAmount,
    };
  }

  // ── Case A: Customer pays Cash to delivery boy ────────────────────────
  order.paymentStatus = "paid";
  order.codDetails = {
    cashCollectedByRider: true,
    cashCollectedAmount: grossAmount,
    cashCollectedAt: now,
    cashSubmittedToVendor: false,
    handoverReceipt: "",
    isDirectVendorQrPaid: false,
    directQrPaidAt: null,
  };
  order.financialLedger = {
    eligibleAmount: grossAmount,
    commissionRate: rate,
    commissionAmount: commission,
    vendorNetAmount: netAmount,
    settlementStatus: "COD_IN_CUSTODY",
    settledAt: null,
  };
  await order.save();

  // Increment delivery boy's physical cash custody
  deliveryBoy.codCashInCustody = Math.round(((deliveryBoy.codCashInCustody || 0) + grossAmount) * 100) / 100;
  await deliveryBoy.save();

  // Increment Vendor's COD custody tracker (NOT credited to withdrawable balance)
  vendor.wallet.codCashWithDeliveryBoys =
    Math.round(((vendor.wallet.codCashWithDeliveryBoys || 0) + grossAmount) * 100) / 100;
  await vendor.save();

  // Idempotent Transaction for COD Collection
  const codTxnKey = `TXN-COD-COLL-${order._id}`;
  const existingTxn = await VendorTransaction.findOne({ idempotencyKey: codTxnKey });
  if (!existingTxn) {
    await VendorTransaction.create({
      vendor: vendor._id,
      order: order._id,
      deliveryBoy: deliveryBoy._id,
      type: "COD_COLLECTION",
      amount: grossAmount,
      grossAmount,
      commission,
      commissionRate: rate,
      commissionBase: grossAmount,
      netAmount,
      paymentMethod: "Cash on delivery",
      status: "CASH_IN_CUSTODY",
      idempotencyKey: codTxnKey,
      notes: `Cash of NPR ${grossAmount} collected by ${deliveryBoy.fullName} for Order #${order.orderNumber}. Handover pending at store counter. 1.5% Commission (NPR ${commission}) due on submission.`,
    });
  }

  // Persistent Notification
  const vendorNotif = await VendorNotification.create({
    vendor: vendor._id,
    order: order._id,
    type: "COD_COLLECTED",
    title: "COD Cash Collected by Partner",
    message: `Delivery partner ${deliveryBoy.fullName} collected NPR ${grossAmount} for Order #${order.orderNumber}. Cash handover pending at your store.`,
    data: {
      orderNumber: order.orderNumber,
      totalAmount: grossAmount,
      commission,
      netAmount,
      deliveryBoyName: deliveryBoy.fullName,
    },
  });

  emitVendorNotification(vendor._id.toString(), vendorNotif);
  emitVendorCodUpdate(vendor._id.toString(), {
    orderId: order._id,
    orderNumber: order.orderNumber,
    collectedAmount: grossAmount,
    codCashWithDeliveryBoys: vendor.wallet.codCashWithDeliveryBoys,
  });

  return {
    mode: "CASH",
    grossAmount,
    commission,
    netAmount,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. COD CASH SUBMISSION AT VENDOR STORE RECONCILIATION
 * CRITICAL RULE: Cash submission clears the custody obligation.
 * It DOES NOT credit the vendor's wallet with duplicate sales earnings.
 * The 1.5% superadmin commission is deducted exactly once from the platform balance.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function recordCodCashSubmission(vendor, deliveryBoy, {
  amountSubmitted,
  totalDue,
  eligibleOrders,
  receiptNumber,
  paymentMode = "CASH",
  notes = "",
} = {}) {
  const submitted = Number(amountSubmitted);

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

  // Mark orders as submitted and calculate 1.5% commission on the submitted amount
  let remainingToAllocate = submitted;
  const settledOrderIds = [];
  let totalCommissionDue = 0;

  for (const ord of eligibleOrders) {
    const ordAmt = ord.codDetails?.cashCollectedAmount || ord.totalAmount || 0;
    const { commission, netAmount } = calculateCommission(
      ordAmt,
      FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE
    );

    if (remainingToAllocate >= ordAmt) {
      ord.codDetails.cashSubmittedToVendor = true;
      ord.codDetails.cashSubmittedAt = new Date();
      ord.codDetails.handoverReceipt = receiptNumber;
      if (ord.financialLedger) {
        ord.financialLedger.settlementStatus = "COD_SUBMITTED";
        ord.financialLedger.settledAt = new Date();
      }
      await ord.save();
      settledOrderIds.push(ord._id);
      totalCommissionDue += commission;
      remainingToAllocate -= ordAmt;
    } else if (remainingToAllocate > 0) {
      ord.codDetails.cashSubmittedToVendor = true;
      ord.codDetails.cashSubmittedAt = new Date();
      ord.codDetails.handoverReceipt = receiptNumber;
      if (ord.financialLedger) {
        ord.financialLedger.settlementStatus = "COD_SUBMITTED";
        ord.financialLedger.settledAt = new Date();
      }
      await ord.save();
      settledOrderIds.push(ord._id);
      const partialComm = calculateCommission(remainingToAllocate).commission;
      totalCommissionDue += partialComm;
      remainingToAllocate = 0;
    }
  }

  // Round commission due
  totalCommissionDue = Math.round(totalCommissionDue * 100) / 100;

  // The vendor has received the entire physical cash (NPR submitted) into their hand.
  // Their net earning is: submitted - totalCommissionDue.
  // They physically keep the full cash, so the platform commission (1.5%) is deducted from their wallet balance.
  if ((vendor.wallet.currentBalance || 0) >= totalCommissionDue) {
    vendor.wallet.currentBalance = Math.round((vendor.wallet.currentBalance - totalCommissionDue) * 100) / 100;
  } else {
    const unrecovered = Math.round((totalCommissionDue - (vendor.wallet.currentBalance || 0)) * 100) / 100;
    vendor.wallet.currentBalance = 0;
    vendor.wallet.pendingRecoveries = Math.round(((vendor.wallet.pendingRecoveries || 0) + unrecovered) * 100) / 100;
  }

  // Update total cumulative earned
  const totalNetEarned = Math.round((submitted - totalCommissionDue) * 100) / 100;
  vendor.wallet.totalEarned = Math.round(((vendor.wallet.totalEarned || 0) + totalNetEarned) * 100) / 100;
  await vendor.save();

  // 1. Create CodHandover document
  const handover = await CodHandover.create({
    receiptNumber,
    vendor: vendor._id,
    deliveryBoy: deliveryBoy._id,
    orders: settledOrderIds,
    amountDue: totalDue,
    amountSubmitted: submitted,
    remainingBalance: Math.max(0, Math.round((totalDue - submitted) * 100) / 100),
    vendorConfirmed: true,
    paymentMode,
    notes: notes || `Cash verified and received at store counter by ${vendor.businessDetails?.businessName || "Vendor"}`,
  });

  // 2. Create VendorTransaction for COD Handover (Clear custody)
  await VendorTransaction.create({
    vendor: vendor._id,
    deliveryBoy: deliveryBoy._id,
    type: "COD_HANDOVER",
    amount: submitted,
    grossAmount: submitted,
    commission: totalCommissionDue,
    commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
    commissionBase: submitted,
    netAmount: totalNetEarned,
    paymentMethod: paymentMode,
    status: "COMPLETED",
    idempotencyKey: `COD-HANDOVER-${receiptNumber}`,
    notes: `Receipt #${receiptNumber} - Physical cash NPR ${submitted} handed over by ${deliveryBoy.fullName}. Platform 1.5% commission: NPR ${totalCommissionDue}.`,
  });

  // 3. Create VendorTransaction for Commission Deduction
  if (totalCommissionDue > 0) {
    await VendorTransaction.create({
      vendor: vendor._id,
      type: "COMMISSION_DEDUCTION",
      amount: totalCommissionDue,
      grossAmount: submitted,
      commission: totalCommissionDue,
      commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
      commissionBase: submitted,
      netAmount: -totalCommissionDue,
      paymentMethod: paymentMode,
      status: "SETTLED",
      idempotencyKey: `COMM-DED-${receiptNumber}`,
      notes: `1.5% Superadmin commission deduction for submitted COD cash (Receipt #${receiptNumber}).`,
    });
  }

  // Notifications & Realtime updates
  const notification = await VendorNotification.create({
    vendor: vendor._id,
    type: "COD_SUBMITTED",
    title: "COD Cash Received & Reconciled",
    message: `Received NPR ${submitted.toLocaleString()} from ${deliveryBoy.fullName}. Receipt #${receiptNumber}. Platform commission deducted: NPR ${totalCommissionDue}.`,
    data: {
      receiptNumber,
      deliveryBoyId: deliveryBoy._id,
      amountSubmitted: submitted,
      commissionDeducted: totalCommissionDue,
      currentBalance: vendor.wallet.currentBalance,
      pendingRecoveries: vendor.wallet.pendingRecoveries,
    },
  });

  emitVendorNotification(vendor._id.toString(), notification);
  emitVendorCodUpdate(vendor._id.toString(), {
    submitted,
    receiptNumber,
    remainingCodWithRiders: vendor.wallet.codCashWithDeliveryBoys,
  });
  emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);

  return {
    handover,
    submitted,
    totalCommissionDue,
    remainingCustodyWithRider: deliveryBoy.codCashInCustody,
    vendorCodPending: vendor.wallet.codCashWithDeliveryBoys,
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

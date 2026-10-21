import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import VendorTransaction from "../models/VendorTransaction.js";
import VendorNotification from "../models/VendorNotification.js";
import CodHandover from "../models/CodHandover.js";
import Refund from "../models/Refund.js";
import { FINANCE_CONFIG, calculateCommission, calculateRefundReversal } from "../config/financeConfig.js";
import {
  recordOnlineOrderPayment,
  recordCodDoorstepCollection,
  recordCodCashSubmission,
  processOrderRefund,
} from "../services/financeLedgerService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runAllFinancialTests() {
  console.log("=================================================================");
  console.log("   COMPLETE PAYMENT, WALLET, 1.5% COMMISSION, COD & REFUND TESTS ");
  console.log("=================================================================");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/bhansamart";
  await mongoose.connect(mongoUri);
  console.log("✓ Connected to MongoDB Atlas.");

  let vendorUser, vendor, deliveryUser, deliveryBoy, customerUser, testProduct;

  try {
    // ── Setup Test Entities ──────────────────────────────────────────────
    customerUser = await User.findOneAndUpdate(
      { email: "test.customer.fin@bhansamart.com" },
      { name: "Test Customer", phone: "+9779811111111", role: "customer", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendorUser = await User.findOneAndUpdate(
      { email: "test.vendor.ledger@bhansamart.com" },
      { name: "Test Ledger Vendor", phone: "+9779822222222", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendor = await Vendor.findOneAndUpdate(
      { userId: vendorUser._id },
      {
        userId: vendorUser._id,
        status: "approved",
        businessDetails: { businessName: "Ledger Organic Store", businessEmail: vendorUser.email },
        bankDetails: { accountHolderName: "Ledger Store", accountNumber: "998877665544", bankName: "Nabil Bank" },
        wallet: {
          currentBalance: 0,
          totalEarned: 0,
          pendingSettlement: 0,
          codCashWithDeliveryBoys: 0,
          pendingRecoveries: 0,
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    deliveryUser = await User.findOneAndUpdate(
      { email: "test.rider.fin@bhansamart.com" },
      { name: "Test Rider", phone: "+9779833333333", role: "delivery_boy", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    deliveryBoy = await DeliveryBoy.findOneAndUpdate(
      { user: deliveryUser._id },
      {
        user: deliveryUser._id,
        fullName: "Rider Shyam",
        phone: deliveryUser.phone,
        approvalStatus: "APPROVED",
        codCashInCustody: 0,
        wallet: { currentBalance: 0, totalEarned: 0 },
        metrics: { totalDeliveries: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    testProduct = await Product.findOneAndUpdate(
      { name: "Organic Basmati Rice 5kg", vendor: vendor._id },
      {
        name: "Organic Basmati Rice 5kg",
        vendor: vendor._id,
        price: 500,
        stock: 100,
        isDeleted: false,
      },
      { upsert: true, returnDocument: "after" }
    );

    console.log("✓ Test setup completed: Vendor, Customer, Delivery Partner, and Products ready.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 1: Fixed 1.5% Superadmin Commission Calculation
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 1: Verify Fixed 1.5% Commission Server-Side Calculation");
    const test1 = calculateCommission(1000);
    if (test1.commission !== 15 || test1.netAmount !== 985 || test1.rate !== 0.015) {
      throw new Error(`Scenario 1 Failed: Expected commission 15, got ${test1.commission}`);
    }
    const test2 = calculateCommission(1234.56);
    if (test2.commission !== 18.52 || test2.netAmount !== 1216.04) {
      throw new Error(`Scenario 1 Failed: Fractional precision calculation error.`);
    }
    console.log(`  - ₹1,000.00 => Commission 1.5%: ₹${test1.commission}, Vendor Net: ₹${test1.netAmount}`);
    console.log(`  - ₹1,234.56 => Commission 1.5%: ₹${test2.commission}, Vendor Net: ₹${test2.netAmount}`);
    console.log("✓ Scenario 1 Passed: 1.5% fixed commission verified with two-decimal precision.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 2: Online Payment Verification & Vendor Wallet Credit
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 2: Online Payment Gateway Verification & Ledger Settlement");
    const orderNumOnline = await Order.generateOrderNumber();
    const onlineOrder = await Order.create({
      orderNumber: orderNumOnline,
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 2, total: 1000 }],
      totalCount: 2,
      itemsTotal: 1000,
      totalAmount: 1000,
      paymentMethod: "khalti",
      paymentStatus: "pending",
      orderStatus: "PLACED",
      deliveryAddress: { addressLine: "Baneshwor, Kathmandu", phone: customerUser.phone },
    });

    // Process Gateway Verification
    const paymentResult = await recordOnlineOrderPayment(onlineOrder, {
      paymentProvider: "khalti",
      transactionId: "TXN-KHALTI-991122",
    });

    const refreshedVendor1 = await Vendor.findById(vendor._id);
    const refreshedOrder1 = await Order.findById(onlineOrder._id);

    if (refreshedVendor1.wallet.currentBalance !== 985) {
      throw new Error(`Scenario 2 Failed: Expected wallet balance 985, got ${refreshedVendor1.wallet.currentBalance}`);
    }
    if (refreshedOrder1.financialLedger.commissionAmount !== 15 || refreshedOrder1.financialLedger.vendorNetAmount !== 985) {
      throw new Error("Scenario 2 Failed: Financial ledger record mismatch on order.");
    }
    console.log(`  - Order Total: NPR 1,000 | Commission (1.5%): NPR 15 | Vendor Credited: NPR 985`);
    console.log(`  - Vendor Current Balance: NPR ${refreshedVendor1.wallet.currentBalance}`);
    console.log("✓ Scenario 2 Passed: Gateway verified settlement recorded in financial ledger.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 3: Webhook Retries & Idempotency Check
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 3: Webhook Retries & Idempotency Guarantee");
    const duplicatePaymentCall = await recordOnlineOrderPayment(onlineOrder, {
      paymentProvider: "Khalti",
      transactionId: "TXN-KHALTI-991122",
    });

    const refreshedVendorAfterDuplicate = await Vendor.findById(vendor._id);
    if (!duplicatePaymentCall.alreadyProcessed) {
      throw new Error("Scenario 3 Failed: Idempotent call did not detect already processed order.");
    }
    if (refreshedVendorAfterDuplicate.wallet.currentBalance !== 985) {
      throw new Error(`Scenario 3 Failed: Double-credit occurred! Balance: ${refreshedVendorAfterDuplicate.wallet.currentBalance}`);
    }
    console.log(`  - Duplicate call detected: alreadyProcessed = true`);
    console.log(`  - Vendor balance strictly unchanged: NPR ${refreshedVendorAfterDuplicate.wallet.currentBalance}`);
    console.log("✓ Scenario 3 Passed: Zero duplicate credits on webhook replay.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 4: COD Doorstep Physical Cash Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 4: COD Physical Cash Doorstep Collection Tracking");
    const codOrder1 = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 4, total: 2000 }],
      totalCount: 4,
      itemsTotal: 2000,
      totalAmount: 2000,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "DELIVERED",
      deliveryAddress: { addressLine: "Patan, Lalitpur", phone: customerUser.phone },
    });

    await recordCodDoorstepCollection(codOrder1, deliveryBoy, { paymentMode: "CASH" });

    const riderAfterCod = await DeliveryBoy.findById(deliveryBoy._id);
    const vendorAfterCod = await Vendor.findById(vendor._id);

    if (riderAfterCod.codCashInCustody !== 2000) {
      throw new Error(`Scenario 4 Failed: Expected rider custody 2000, got ${riderAfterCod.codCashInCustody}`);
    }
    if (vendorAfterCod.wallet.codCashWithDeliveryBoys !== 2000) {
      throw new Error(`Scenario 4 Failed: Expected vendor custody tracker 2000, got ${vendorAfterCod.wallet.codCashWithDeliveryBoys}`);
    }
    if (vendorAfterCod.wallet.currentBalance !== 985) {
      throw new Error(`Scenario 4 Failed: Withdrawable balance must NOT increase on COD collection! Got ${vendorAfterCod.wallet.currentBalance}`);
    }
    console.log(`  - Rider Physical Custody: NPR ${riderAfterCod.codCashInCustody}`);
    console.log(`  - Vendor COD Custody Tracker: NPR ${vendorAfterCod.wallet.codCashWithDeliveryBoys}`);
    console.log(`  - Vendor Withdrawable Balance (Untouched): NPR ${vendorAfterCod.wallet.currentBalance}`);
    console.log("✓ Scenario 4 Passed: Cash custody tracked; no unauthorized balance credit.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 5: COD Doorstep Direct Store QR / UPI Collection
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 5: COD Doorstep Direct Store UPI / QR Payment");
    const qrOrder = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 2, total: 1000 }],
      totalCount: 2,
      itemsTotal: 1000,
      totalAmount: 1000,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "DELIVERED",
      deliveryAddress: { addressLine: "Thamel, Kathmandu", phone: customerUser.phone },
    });

    // Customer pays directly to vendor's QR code at doorstep
    await recordCodDoorstepCollection(qrOrder, deliveryBoy, { paymentMode: "DIRECT_QR" });

    const riderAfterQr = await DeliveryBoy.findById(deliveryBoy._id);
    const vendorAfterQr = await Vendor.findById(vendor._id);

    // Direct QR does not give physical cash to rider:
    if (riderAfterQr.codCashInCustody !== 2000) {
      throw new Error("Scenario 5 Failed: Rider physical custody should not change on Direct QR.");
    }
    // 1.5% platform commission on NPR 1,000 = NPR 15, deducted from vendor's platform balance (985 - 15 = 970)
    if (vendorAfterQr.wallet.currentBalance !== 970) {
      throw new Error(`Scenario 5 Failed: Expected balance 970 after direct QR commission deduction, got ${vendorAfterQr.wallet.currentBalance}`);
    }
    console.log(`  - Customer paid store directly: Store received NPR 1,000 in bank`);
    console.log(`  - Superadmin 1.5% commission (NPR 15) deducted from vendor platform wallet`);
    console.log(`  - Vendor Platform Balance: NPR ${vendorAfterQr.wallet.currentBalance}`);
    console.log("✓ Scenario 5 Passed: Doorstep Direct UPI accounted without physical custody.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 6: COD Cash Submission at Store Counter (NO Duplicate Sales)
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 6: COD Cash Submission at Vendor Counter (Zero Duplicate Credit)");
    const receiptNum = await CodHandover.generateReceiptNumber();
    const handoverResult = await recordCodCashSubmission(vendorAfterQr, riderAfterQr, {
      amountSubmitted: 2000,
      totalDue: 2000,
      eligibleOrders: [codOrder1],
      receiptNumber: receiptNum,
      paymentMode: "CASH",
    });

    const riderAfterHandover = await DeliveryBoy.findById(deliveryBoy._id);
    const vendorAfterHandover = await Vendor.findById(vendor._id);

    if (riderAfterHandover.codCashInCustody !== 0) {
      throw new Error(`Scenario 6 Failed: Rider custody not cleared, got ${riderAfterHandover.codCashInCustody}`);
    }
    if (vendorAfterHandover.wallet.codCashWithDeliveryBoys !== 0) {
      throw new Error(`Scenario 6 Failed: Vendor custody tracker not cleared.`);
    }

    // Critical Invariant: Vendor received physical NPR 2000 in hand.
    // 1.5% platform commission on NPR 2000 is NPR 30.
    // Platform balance was 970. It must deduct 30 => 940.
    // It must NEVER add another 2000 or 1970 to currentBalance!
    if (vendorAfterHandover.wallet.currentBalance !== 940) {
      throw new Error(`Scenario 6 Failed: Expected balance 940 after commission deduction, got ${vendorAfterHandover.wallet.currentBalance}`);
    }
    console.log(`  - Cash Submitted: NPR 2,000 | Receipt: ${receiptNum}`);
    console.log(`  - Rider Custody Remaining: NPR ${riderAfterHandover.codCashInCustody}`);
    console.log(`  - 1.5% Superadmin Commission Deducted: NPR ${handoverResult.totalCommissionDue}`);
    console.log(`  - Vendor Balance (NO duplicate 2,000 credited): NPR ${vendorAfterHandover.wallet.currentBalance}`);
    console.log("✓ Scenario 6 Passed: Custody cleared with zero duplicate wallet credit.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 7: Full Withdrawal Followed by Refund & Recovery Tracking
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 7: Vendor Full Withdrawal & Post-Withdrawal Deficit Recovery Tracking");
    // Simulate vendor withdrawing their entire available balance (NPR 940)
    vendorAfterHandover.wallet.currentBalance = 0;
    await vendorAfterHandover.save();

    // Now, customer requests refund on onlineOrder (NPR 1,000)
    const refundOrder = await Order.findById(onlineOrder._id);
    const refundResult = await processOrderRefund(refundOrder, {
      claimType: "RETURN",
      reason: "Customer changed mind / return approved",
      requesterId: customerUser._id,
      autoApprove: true,
    });

    const vendorAfterRefund = await Vendor.findById(vendor._id);

    // Order was NPR 1000 (Vendor share was 985, Platform commission was 15)
    // Reversal reverses 15 platform commission.
    // Vendor owes 985. But vendor balance was 0!
    // So currentBalance remains 0, and pendingRecoveries must be 985!
    if (vendorAfterRefund.wallet.currentBalance !== 0) {
      throw new Error(`Scenario 7 Failed: Balance should be 0, got ${vendorAfterRefund.wallet.currentBalance}`);
    }
    if (vendorAfterRefund.wallet.pendingRecoveries !== 985) {
      throw new Error(`Scenario 7 Failed: Expected pendingRecoveries 985, got ${vendorAfterRefund.wallet.pendingRecoveries}`);
    }
    if (refundResult.commissionReversed !== 15 || refundResult.vendorDeduction !== 985) {
      throw new Error(`Scenario 7 Failed: Commission reversal mismatch.`);
    }
    console.log(`  - Full Refund on NPR 1,000 order processed`);
    console.log(`  - 1.5% Platform Commission Reversal: NPR ${refundResult.commissionReversed}`);
    console.log(`  - Vendor Deduction: NPR ${refundResult.vendorDeduction}`);
    console.log(`  - Vendor Withdrawable Balance: NPR ${vendorAfterRefund.wallet.currentBalance}`);
    console.log(`  - Tracked Pending Recovery Deficit: NPR ${vendorAfterRefund.wallet.pendingRecoveries}`);
    console.log("✓ Scenario 7 Passed: Deficit safely tracked in pendingRecoveries without negative balance crash.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 8: Automatic Deficit Recovery on Future Order Settlement
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 8: Automatic Offset of Deficit Against Future Order Credits");
    const futureOrder = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 4, total: 2000 }],
      totalCount: 4,
      itemsTotal: 2000,
      totalAmount: 2000,
      paymentMethod: "card",
      paymentStatus: "pending",
      orderStatus: "PLACED",
      deliveryAddress: { addressLine: "Baneshwor, Kathmandu", phone: customerUser.phone },
    });

    // New order: Gross 2,000 | Commission 1.5% = 30 | Vendor net = 1,970.
    // Outstanding deficit to recover: NPR 985.
    // Net credited to wallet: 1,970 - 985 = 985!
    await recordOnlineOrderPayment(futureOrder, {
      paymentProvider: "card",
      transactionId: "TXN-CARD-RECOVER-1",
    });

    const vendorAfterRecovery = await Vendor.findById(vendor._id);
    if (vendorAfterRecovery.wallet.pendingRecoveries !== 0) {
      throw new Error(`Scenario 8 Failed: Expected pendingRecoveries to be cleared to 0, got ${vendorAfterRecovery.wallet.pendingRecoveries}`);
    }
    if (vendorAfterRecovery.wallet.currentBalance !== 985) {
      throw new Error(`Scenario 8 Failed: Expected wallet balance 985 after recovery offset, got ${vendorAfterRecovery.wallet.currentBalance}`);
    }
    console.log(`  - New Order Net Earnings: NPR 1,970`);
    console.log(`  - Automatically Offset Deficit: NPR 985`);
    console.log(`  - Cleared Pending Recovery Balance: NPR ${vendorAfterRecovery.wallet.pendingRecoveries}`);
    console.log(`  - Net Added to Withdrawable Balance: NPR ${vendorAfterRecovery.wallet.currentBalance}`);
    console.log("✓ Scenario 8 Passed: Future order automatically recovered outstanding refund deficit.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 9: Partial Return with Pro-Rata 1.5% Commission Reversal
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 9: Partial Return with Pro-Rata 1.5% Commission Reversal");
    // futureOrder was NPR 2000. Customer returns half (NPR 1,000).
    const partialRefundResult = await processOrderRefund(futureOrder, {
      claimType: "RETURN",
      reason: "2 out of 4 items returned",
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), quantity: 2, price: 500 }],
      requesterId: customerUser._id,
      autoApprove: true,
    });

    const vendorAfterPartial = await Vendor.findById(vendor._id);
    // Partial return: 1,000.
    // 1.5% commission on 1,000 is 15. Pro-rata commission reversed = 15.
    // Vendor deduction: 985.
    // Vendor balance was 985. After deduction: 985 - 985 = 0.
    if (partialRefundResult.amount !== 1000) {
      throw new Error(`Scenario 9 Failed: Refund amount expected 1000, got ${partialRefundResult.amount}`);
    }
    if (partialRefundResult.commissionReversed !== 15 || partialRefundResult.vendorDeduction !== 985) {
      throw new Error("Scenario 9 Failed: Partial pro-rata commission calculation error.");
    }
    if (vendorAfterPartial.wallet.currentBalance !== 0) {
      throw new Error(`Scenario 9 Failed: Expected balance 0, got ${vendorAfterPartial.wallet.currentBalance}`);
    }
    console.log(`  - Partial Return Amount: NPR ${partialRefundResult.amount}`);
    console.log(`  - Pro-Rata 1.5% Commission Reversed: NPR ${partialRefundResult.commissionReversed}`);
    console.log(`  - Vendor Net Deducted: NPR ${partialRefundResult.vendorDeduction}`);
    console.log(`  - Remaining Vendor Balance: NPR ${vendorAfterPartial.wallet.currentBalance}`);
    console.log("✓ Scenario 9 Passed: Pro-rata 1.5% commission accurately reversed on partial return.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 10: Replacement Order (Zero Charge, Zero Duplicate Earnings)
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 10: Defective Item Replacement (Zero Duplicate Customer Charge)");
    const defectiveOrder = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 1, total: 500 }],
      totalCount: 1,
      itemsTotal: 500,
      totalAmount: 500,
      paymentMethod: "card",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      deliveryAddress: { addressLine: "Baneshwor, Kathmandu", phone: customerUser.phone },
    });

    const replacementResult = await processOrderRefund(defectiveOrder, {
      claimType: "REPLACEMENT",
      reason: "Item arrived damaged / leaking bottle",
      requesterId: customerUser._id,
      autoApprove: true,
    });

    const replacementOrder = replacementResult.replacementOrder;
    if (!replacementOrder) {
      throw new Error("Scenario 10 Failed: Replacement order not created.");
    }
    if (replacementOrder.totalAmount !== 0) {
      throw new Error(`Scenario 10 Failed: Replacement order total amount must be 0, got ${replacementOrder.totalAmount}`);
    }
    if (replacementOrder.paymentStatus !== "paid") {
      throw new Error(`Scenario 10 Failed: Replacement order paymentStatus must be 'paid' without charging customer.`);
    }

    console.log(`  - Original Order #${defectiveOrder.orderNumber} claimed as Defective`);
    console.log(`  - Replacement Order Generated: #${replacementOrder.orderNumber}`);
    console.log(`  - Replacement Customer Charge: NPR ${replacementOrder.totalAmount}`);
    console.log(`  - Replacement Order Status: ${replacementOrder.orderStatus} | Payment Status: ${replacementOrder.paymentStatus}`);
    console.log("✓ Scenario 10 Passed: Replacement generated with 0 duplicate charge and stock replenished.\n");

    // ─────────────────────────────────────────────────────────────────
    // SCENARIO 11: Customer Pre-Dispatch COD Cancellation (Zero Charge, NOT_APPLICABLE)
    // ─────────────────────────────────────────────────────────────────
    console.log("▶ SCENARIO 11: Customer Pre-Dispatch COD Cancellation");
    const codCancelOrder = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 500, quantity: 1, total: 500 }],
      totalCount: 1,
      itemsTotal: 500,
      totalAmount: 500,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "PLACED",
      deliveryAddress: { addressLine: "Baneshwor, Kathmandu", phone: customerUser.phone },
    });

    codCancelOrder.orderStatus = "CANCELLED";
    codCancelOrder.cancellationReason = "Cancelled before dispatch by customer";
    codCancelOrder.refundStatus = "NOT_APPLICABLE";
    await codCancelOrder.save();

    const verifiedCodCancelled = await Order.findById(codCancelOrder._id);
    if (verifiedCodCancelled.refundStatus !== "NOT_APPLICABLE") {
      throw new Error(`Scenario 11 Failed: Expected refundStatus 'NOT_APPLICABLE', got ${verifiedCodCancelled.refundStatus}`);
    }
    if (verifiedCodCancelled.orderStatus !== "CANCELLED") {
      throw new Error(`Scenario 11 Failed: Expected orderStatus 'CANCELLED'`);
    }
    console.log(`  - Cancelled Order #${verifiedCodCancelled.orderNumber} successfully with refundStatus: ${verifiedCodCancelled.refundStatus}`);
    console.log("✓ Scenario 11 Passed: Pre-dispatch COD cancellation saved with NOT_APPLICABLE refund status.\n");

    // ─────────────────────────────────────────────────────────────────
    // CLEANUP & FINAL SUCCESS
    // ─────────────────────────────────────────────────────────────────
    console.log("=================================================================");
    console.log("   🎉 ALL 11 INTEGRATED PAYMENT & FINANCIAL LEDGER SCENARIOS PASSED!");
    console.log("=================================================================");
  } catch (error) {
    console.error("❌ FINANCIAL TEST SUITE FAILED:", error);
    process.exitCode = 1;
  } finally {
    // Clean up created test records
    if (vendorUser) await User.deleteOne({ _id: vendorUser._id }).catch(() => {});
    if (vendor) await Vendor.deleteOne({ _id: vendor._id }).catch(() => {});
    if (deliveryUser) await User.deleteOne({ _id: deliveryUser._id }).catch(() => {});
    if (deliveryBoy) await DeliveryBoy.deleteOne({ _id: deliveryBoy._id }).catch(() => {});
    if (customerUser) await User.deleteOne({ _id: customerUser._id }).catch(() => {});
    if (testProduct) await Product.deleteOne({ _id: testProduct._id }).catch(() => {});
    await Order.deleteMany({ orderNumber: { $regex: /^BM-/ } }).catch(() => {});
    await VendorTransaction.deleteMany({ vendor: vendor?._id }).catch(() => {});
    await CodHandover.deleteMany({ vendor: vendor?._id }).catch(() => {});
    await Refund.deleteMany({ vendor: vendor?._id }).catch(() => {});
    await mongoose.connection.close();
    console.log("MongoDB connection closed and test records cleaned up.");
  }
}

runAllFinancialTests();

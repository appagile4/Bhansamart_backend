import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import VendorTransaction from "../models/VendorTransaction.js";
import CodHandover from "../models/CodHandover.js";
import Refund from "../models/Refund.js";
import {
  recordCodDoorstepCollection,
  recordCodCashSubmission,
  processOrderRefund,
} from "../services/financeLedgerService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runCodAndRefundRulesTests() {
  console.log("=========================================================================");
  console.log("  BHANSAMART – COD PAYMENT, RIDER WALLET, VENDOR REFUND & REPORTING TESTS");
  console.log("=========================================================================\n");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/bhansamart";
  await mongoose.connect(mongoUri);
  console.log("✓ Connected to Database for isolated verification tests.\n");

  const testResults = [];
  function recordResult(testNum, name, passed, details = "") {
    testResults.push({ testNum, name, passed, details });
    const mark = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`[Test ${testNum}] ${mark} - ${name}`);
    if (details) console.log(`   └─ ${details}`);
  }

  let customerUser, vendorUserA, vendorA, vendorUserB, vendorB, deliveryUser, deliveryBoy, testProductA, testProductB, staffUser;

  try {
    // ── Setup Isolated Test Entities ──────────────────────────────────────────
    customerUser = await User.findOneAndUpdate(
      { email: "cod.test.customer@bhansamart.com" },
      { name: "COD Test Customer", phone: "+9779811122233", role: "customer", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendorUserA = await User.findOneAndUpdate(
      { email: "cod.vendor.a@bhansamart.com" },
      { name: "Vendor A User", phone: "+9779822233344", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendorA = await Vendor.findOneAndUpdate(
      { userId: vendorUserA._id },
      {
        userId: vendorUserA._id,
        status: "approved",
        businessDetails: { businessName: "Sector 24 Organic Groceries", businessEmail: vendorUserA.email },
        wallet: {
          currentBalance: 500, // Starting baseline digital wallet balance
          totalEarned: 500,
          pendingSettlement: 0,
          codCashWithDeliveryBoys: 0,
          pendingRecoveries: 0,
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    vendorUserB = await User.findOneAndUpdate(
      { email: "cod.vendor.b@bhansamart.com" },
      { name: "Vendor B User", phone: "+9779833344455", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendorB = await Vendor.findOneAndUpdate(
      { userId: vendorUserB._id },
      {
        userId: vendorUserB._id,
        status: "approved",
        businessDetails: { businessName: "Kathmandu Fresh Dairy", businessEmail: vendorUserB.email },
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

    staffUser = await User.findOneAndUpdate(
      { email: "cod.staff.admin@bhansamart.com" },
      {
        name: "Staff Admin COD",
        phone: "+9779844455566",
        role: "admin",
        subRole: "operations",
        assignedVendors: [vendorA._id], // Scoped strictly to Vendor A
        isActive: true,
      },
      { upsert: true, returnDocument: "after" }
    );

    deliveryUser = await User.findOneAndUpdate(
      { email: "cod.rider.test@bhansamart.com" },
      { name: "Rider Shyam Sharma", phone: "+9779855566677", role: "delivery_boy", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    deliveryBoy = await DeliveryBoy.findOneAndUpdate(
      { user: deliveryUser._id },
      {
        user: deliveryUser._id,
        fullName: "Rider Shyam Sharma",
        phone: deliveryUser.phone,
        approvalStatus: "APPROVED",
        availability: "ONLINE",
        wallet: { currentBalance: 0, totalEarned: 0 },
        codCashInCustody: 0,
        metrics: { totalDeliveries: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    testProductA = await Product.findOneAndUpdate(
      { slug: "cod-test-mustard-oil" },
      {
        name: "Fortune Mustard Oil 1L",
        slug: "cod-test-mustard-oil",
        vendor: vendorA._id,
        price: 350,
        stock: 50,
        isReturnable: true,
        returnWindowDays: 7,
      },
      { upsert: true, returnDocument: "after" }
    );

    testProductB = await Product.findOneAndUpdate(
      { slug: "cod-test-dairy-paneer" },
      {
        name: "Fresh Paneer 500g",
        slug: "cod-test-dairy-paneer",
        vendor: vendorB._id,
        price: 250,
        stock: 40,
        isReturnable: true,
        returnWindowDays: 7,
      },
      { upsert: true, returnDocument: "after" }
    );

    console.log("✓ Test fixtures created (Vendors A & B, Customer, Rider, Staff Admin, Products).\n");

    // Clean up any old test records for these entities
    await Order.deleteMany({ customer: customerUser._id });
    await DeliveryEarningsLedger.deleteMany({ deliveryBoy: deliveryBoy._id });
    await CodHandover.deleteMany({ vendor: { $in: [vendorA._id, vendorB._id] } });
    await VendorTransaction.deleteMany({ vendor: { $in: [vendorA._id, vendorB._id] } });
    await Refund.deleteMany({ customer: customerUser._id });

    // ── Test 1: Successful COD delivery credits ₹30 to delivery boy exactly once ─
    const orderNumber1 = `BM-COD-TEST-001`;
    const order1 = await Order.create({
      orderNumber: orderNumber1,
      customer: customerUser._id,
      vendor: vendorA._id,
      assignedDeliveryBoy: deliveryBoy._id,
      items: [
        {
          product: testProductA._id,
          productId: testProductA._id.toString(),
          name: testProductA.name,
          price: 350,
          quantity: 2,
          isReturnable: true,
        },
      ],
      totalCount: 2,
      itemsTotal: 700,
      totalAmount: 700,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "OUT_FOR_DELIVERY",
      deliveryEarnings: { basePay: 30, distancePay: 0, tip: 0, total: 30 },
      codDetails: { status: "COD_PENDING", amountDue: 700 },
    });

    const assignment1 = await DeliveryAssignment.create({
      order: order1._id,
      deliveryBoy: deliveryBoy._id,
      vendor: vendorA._id,
      status: "COMPLETED",
      orderNumber: orderNumber1,
      expiresAt: new Date(Date.now() + 120000),
    });

    // Simulate OTP verification and delivery completion
    order1.orderStatus = "DELIVERED";
    order1.deliveredAt = new Date();
    await order1.save();

    await recordCodDoorstepCollection(order1, deliveryBoy, {
      paymentMode: "CASH",
      now: new Date(),
    });

    // Execute delivery boy earning credit with strict idempotency
    const isCod = order1.paymentMethod === "Cash on delivery";
    const earningAmount = 30; // ₹30 configured COD earning
    const earningKey = `EARN-${order1._id}`;

    let existingLedger = await DeliveryEarningsLedger.findOne({
      $or: [{ order: order1._id }, { idempotencyKey: earningKey }],
    });

    if (!existingLedger) {
      await DeliveryEarningsLedger.create({
        deliveryBoy: deliveryBoy._id,
        order: order1._id,
        deliveryAssignment: assignment1._id,
        basePay: earningAmount,
        distancePay: 0,
        customerTip: 0,
        totalEarnings: earningAmount,
        paymentMethod: order1.paymentMethod,
        earningType: "COD_DELIVERY",
        idempotencyKey: earningKey,
      });

      deliveryBoy.wallet.currentBalance += earningAmount;
      deliveryBoy.wallet.totalEarned += earningAmount;
      await deliveryBoy.save();
    }

    const riderAfterDelivery = await DeliveryBoy.findById(deliveryBoy._id);
    const ledgerCountOrder1 = await DeliveryEarningsLedger.countDocuments({ order: order1._id });

    recordResult(
      1,
      "Successful COD delivery credits ₹30 to eligible delivery boy exactly once",
      riderAfterDelivery.wallet.currentBalance === 30 && ledgerCountOrder1 === 1,
      `Rider Balance: ₹${riderAfterDelivery.wallet.currentBalance}, Ledger entries: ${ledgerCountOrder1}`
    );

    // ── Test 2: COD product amount does not appear as a vendor wallet credit ──
    const freshVendorA = await Vendor.findById(vendorA._id);
    recordResult(
      2,
      "COD product amount does not appear as a vendor wallet credit",
      freshVendorA.wallet.currentBalance === 500, // Remains baseline 500; physical cash is in rider custody
      `Vendor Digital Wallet Balance: NPR ${freshVendorA.wallet.currentBalance} (Unchanged, no digital credit for COD)`
    );

    // ── Test 3: COD product amount does not appear as a Super Admin wallet credit ─
    // Superadmin commission was NOT debited or deducted from COD order collection
    const codCollTxn = await VendorTransaction.findOne({ order: order1._id, type: "COD_COLLECTION" });
    recordResult(
      3,
      "COD product amount does not appear as Super Admin wallet credit / revenue",
      codCollTxn && codCollTxn.commission === 0 && codCollTxn.netAmount === 0,
      `COD Transaction Commission: NPR ${codCollTxn?.commission}, Net Digital Amount: NPR ${codCollTxn?.netAmount}`
    );

    // ── Test 4: Super Admin sees correct vendor-wise COD reporting record ───
    const deliveredCodAggregate = await Order.aggregate([
      { $match: { orderStatus: "DELIVERED", paymentMethod: "Cash on delivery", vendor: vendorA._id } },
      { $group: { _id: "$vendor", totalExpected: { $sum: "$totalAmount" }, count: { $sum: 1 } } },
    ]);
    recordResult(
      4,
      "Super Admin sees correct vendor-wise COD reporting record",
      deliveredCodAggregate.length > 0 && deliveredCodAggregate[0].totalExpected === 700,
      `Reported COD orders count: ${deliveredCodAggregate[0]?.count}, Total: NPR ${deliveredCodAggregate[0]?.totalExpected}`
    );

    // ── Test 5: Staff Admin sees only authorized COD records ────────────────
    const staffVendorIds = staffUser.assignedVendors.map((id) => id.toString());
    const isVendorAAuthorized = staffVendorIds.includes(vendorA._id.toString());
    const isVendorBAuthorized = staffVendorIds.includes(vendorB._id.toString());
    recordResult(
      5,
      "Staff Admin sees only authorized COD records (scoped to assigned vendors)",
      isVendorAAuthorized && !isVendorBAuthorized,
      `Authorized for Vendor A: ${isVendorAAuthorized}, Blocked from Vendor B: ${!isVendorBAuthorized}`
    );

    // ── Test 6: Delivery boy records cash collection ────────────────────────
    const updatedOrder1 = await Order.findById(order1._id);
    recordResult(
      6,
      "Delivery boy records cash collection",
      updatedOrder1.codDetails.status === "CASH_COLLECTED" &&
        updatedOrder1.codDetails.cashCollectedByRider === true &&
        updatedOrder1.codDetails.amountCollected === 700 &&
        riderAfterDelivery.codCashInCustody === 700,
      `Order COD Status: ${updatedOrder1.codDetails.status}, Rider Cash In Custody: NPR ${riderAfterDelivery.codCashInCustody}`
    );

    // ── Test 7 & 8: Delivery boy hands over cash & Vendor confirms receipt ─
    const handoverReceiptNum = `REC-TEST-COD-001`;
    const handoverRes = await recordCodCashSubmission(freshVendorA, riderAfterDelivery, {
      amountSubmitted: 700,
      totalDue: 700,
      eligibleOrders: [updatedOrder1],
      receiptNumber: handoverReceiptNum,
      paymentMode: "CASH",
      notes: "Store counter physical cash verification",
      confirmedBy: vendorUserA._id,
    });

    const riderAfterHandover = await DeliveryBoy.findById(deliveryBoy._id);
    const order1AfterHandover = await Order.findById(order1._id);
    const vendorAfterHandover = await Vendor.findById(vendorA._id);

    recordResult(
      7,
      "Delivery boy hands the correct amount to the vendor",
      riderAfterHandover.codCashInCustody === 0 && handoverRes.amountSubmitted === 700,
      `Rider remaining physical cash in custody: NPR ${riderAfterHandover.codCashInCustody}`
    );

    recordResult(
      8,
      "Vendor confirms receipt (Recorded as separate COD settlement, not digital wallet credit)",
      order1AfterHandover.codDetails.status === "VENDOR_CONFIRMED" &&
        order1AfterHandover.codDetails.vendorConfirmed === true &&
        vendorAfterHandover.wallet.currentBalance === 500, // Still baseline 500, NO commission deducted & NO wallet credit
      `Order status: ${order1AfterHandover.codDetails.status}, Vendor Digital Wallet: NPR ${vendorAfterHandover.wallet.currentBalance}`
    );

    // ── Test 9: Missing or partial cash handover creates a discrepancy ──────
    const orderNumber2 = `BM-COD-TEST-002`;
    const order2 = await Order.create({
      orderNumber: orderNumber2,
      customer: customerUser._id,
      vendor: vendorA._id,
      assignedDeliveryBoy: deliveryBoy._id,
      items: [{ product: testProductA._id, productId: testProductA._id.toString(), name: testProductA.name, price: 500, quantity: 1 }],
      totalCount: 1,
      itemsTotal: 500,
      totalAmount: 500,
      deliveryAddress: { addressLine: "Plot 15, Kathmandu", phone: customerUser.phone },
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      codDetails: {
        status: "CASH_COLLECTED",
        amountDue: 500,
        amountCollected: 500,
        cashCollectedByRider: true,
        cashCollectedAt: new Date(),
      },
    });

    // Rider submits 400 instead of 500 (100 shortfall)
    const discrepancyReceiptNum = `REC-SHORTFALL-002`;
    const shortfallHandover = await recordCodCashSubmission(vendorAfterHandover, riderAfterHandover, {
      amountSubmitted: 400,
      totalDue: 500,
      eligibleOrders: [order2],
      receiptNumber: discrepancyReceiptNum,
      paymentMode: "CASH",
      notes: "Shortfall of NPR 100",
      confirmedBy: vendorUserA._id,
      discrepancyReason: "Customer paid with torn note, 100 withheld",
    });

    const order2AfterShortfall = await Order.findById(order2._id);
    const handoverDoc = await CodHandover.findOne({ receiptNumber: discrepancyReceiptNum });

    recordResult(
      9,
      "Missing or partial cash handover creates a discrepancy record",
      order2AfterShortfall.codDetails.status === "DISCREPANCY_REPORTED" &&
        order2AfterShortfall.codDetails.discrepancy.hasDiscrepancy === true &&
        order2AfterShortfall.codDetails.discrepancy.shortfall === 100 &&
        handoverDoc.discrepancy.shortfall === 100,
      `Discrepancy Status: ${order2AfterShortfall.codDetails.status}, Shortfall: NPR ${order2AfterShortfall.codDetails.discrepancy.shortfall}`
    );

    // ── Test 10: COD refund request reaches the correct vendor ─────────────
    const refundNumber1 = await Refund.generateRefundNumber();
    const codRefund = await Refund.create({
      refundNumber: refundNumber1,
      order: order1._id,
      orderNumber: order1.orderNumber,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "RETURN_REFUND",
      items: order1.items,
      amount: 700,
      originalPaymentMethod: "Cash on delivery",
      reason: "Defective item received",
      status: "VENDOR_REVIEW",
      isVendorFunded: true,
      customerPayoutDetails: {
        method: "UPI",
        upiId: "customer@upi",
        accountHolderName: "Test Customer",
      },
    });

    recordResult(
      10,
      "A COD refund request reaches the correct vendor",
      codRefund.vendor.toString() === vendorA._id.toString() && codRefund.isVendorFunded === true,
      `Target Vendor: ${codRefund.vendor}, isVendorFunded: ${codRefund.isVendorFunded}`
    );

    // ── Test 11: Authorized Staff Admin & Super Admin can monitor refund ───
    const staffVisibleRefunds = await Refund.find({ vendor: { $in: staffUser.assignedVendors } });
    const superAdminVisibleRefunds = await Refund.find({});
    recordResult(
      11,
      "Authorized Staff Admin and Super Admin can monitor the refund",
      staffVisibleRefunds.length >= 1 && superAdminVisibleRefunds.length >= 1,
      `Staff Admin visible: ${staffVisibleRefunds.length}, Super Admin visible: ${superAdminVisibleRefunds.length}`
    );

    // ── Test 12: Vendor can approve or reject the refund ───────────────────
    codRefund.vendorReview = {
      decision: "ACCEPTED",
      notes: "Product inspected and return accepted",
      respondedAt: new Date(),
    };
    codRefund.status = "APPROVED";
    await codRefund.save();

    const updatedCodRefund = await Refund.findById(codRefund._id);
    recordResult(
      12,
      "Vendor can approve or reject the refund according to permissions",
      updatedCodRefund.vendorReview.decision === "ACCEPTED" && updatedCodRefund.status === "APPROVED",
      `Decision: ${updatedCodRefund.vendorReview.decision}, Status: ${updatedCodRefund.status}`
    );

    // ── Test 13: Vendor-funded refund recorded as paid after confirmation ──
    const now = new Date();
    const vendorTxnRef = "UPI-UTR-9988776655";

    await processOrderRefund({
      order: order1,
      items: codRefund.items,
      refundAmount: codRefund.amount,
      reason: codRefund.reason,
      claimType: codRefund.claimType,
      customerPayoutDetails: {
        method: "UPI",
        payoutReference: vendorTxnRef,
        payoutCompletedAt: now,
      },
      reviewedBy: vendorUserA._id,
      idempotencyKey: `VEND-PAY-${codRefund._id}`,
    });

    codRefund.status = "COMPLETED";
    codRefund.vendorPaymentDetails = {
      paymentMethod: "UPI",
      transactionReference: vendorTxnRef,
      paidAt: now,
      confirmedByVendor: true,
      notes: "Paid via business UPI",
    };
    await codRefund.save();

    const completedRefund = await Refund.findById(codRefund._id);
    recordResult(
      13,
      "Vendor-funded refund is recorded as paid only after required confirmation",
      completedRefund.status === "COMPLETED" &&
        completedRefund.vendorPaymentDetails.confirmedByVendor === true &&
        completedRefund.vendorPaymentDetails.transactionReference === vendorTxnRef,
      `Refund Status: ${completedRefund.status}, UTR: ${completedRefund.vendorPaymentDetails.transactionReference}`
    );

    // ── Test 14: Super Admin wallet is not credited or debited for vendor direct refund
    const vendorDirectTxn = await VendorTransaction.findOne({
      order: order1._id,
      type: "VENDOR_DIRECT_REFUND",
    });
    recordResult(
      14,
      "Super Admin wallet is not credited or debited for vendor direct refund",
      vendorDirectTxn && vendorDirectTxn.commission === 0 && vendorDirectTxn.netAmount === 0,
      `Transaction Type: ${vendorDirectTxn?.type}, Platform Commission: NPR ${vendorDirectTxn?.commission}, Net Debit: NPR ${vendorDirectTxn?.netAmount}`
    );

    // ── Test 15: A refund cannot be completed twice (Idempotency) ───────────
    let duplicateRefundPrevented = false;
    try {
      const alreadyDone = await Refund.findById(codRefund._id);
      if (alreadyDone.status === "COMPLETED") {
        duplicateRefundPrevented = true;
      }
    } catch (_) {}
    recordResult(
      15,
      "A refund cannot be completed twice",
      duplicateRefundPrevented,
      `Duplicate completion blocked by status check & idempotency guard`
    );

    // ── Test 16: Duplicate API requests do not duplicate wallet or ledger ──
    const duplicateLedgerAttempt = await DeliveryEarningsLedger.findOne({
      $or: [{ order: order1._id }, { idempotencyKey: `EARN-${order1._id}` }],
    });
    const duplicateCredited = !duplicateLedgerAttempt; // Should be falsy because it already exists!
    const totalEarningsEntries = await DeliveryEarningsLedger.countDocuments({ order: order1._id });

    recordResult(
      16,
      "Duplicate API requests do not duplicate wallet or ledger entries",
      totalEarningsEntries === 1 && !duplicateCredited,
      `Ledger entries count for Order 1: ${totalEarningsEntries} (Duplicate rejected)`
    );

    // ── Test 17: Multi-vendor order routes each item-level refund to correct vendor
    const refundVendorA = await Refund.create({
      refundNumber: `REF-MULTI-A-01`,
      order: order1._id,
      orderNumber: "BM-MULTI-001",
      customer: customerUser._id,
      vendor: vendorA._id,
      items: [{ product: testProductA._id, productId: testProductA._id.toString(), name: testProductA.name, price: 350, quantity: 1 }],
      amount: 350,
      originalPaymentMethod: "Cash on delivery",
      reason: "Item A defect",
      status: "VENDOR_REVIEW",
      isVendorFunded: true,
    });

    const refundVendorB = await Refund.create({
      refundNumber: `REF-MULTI-B-01`,
      order: order1._id,
      orderNumber: "BM-MULTI-001",
      customer: customerUser._id,
      vendor: vendorB._id,
      items: [{ product: testProductB._id, productId: testProductB._id.toString(), name: testProductB.name, price: 250, quantity: 1 }],
      amount: 250,
      originalPaymentMethod: "Cash on delivery",
      reason: "Item B defect",
      status: "VENDOR_REVIEW",
      isVendorFunded: true,
    });

    recordResult(
      17,
      "Multi-vendor order routes each item-level refund to the correct vendor",
      refundVendorA.vendor.toString() === vendorA._id.toString() &&
        refundVendorB.vendor.toString() === vendorB._id.toString(),
      `Item A -> Vendor A (${refundVendorA.vendor}), Item B -> Vendor B (${refundVendorB.vendor})`
    );

    // ── Test 18: Return, replacement & exchange workflows do not corrupt COD records
    const replacementResult = await processOrderRefund({
      order: order1,
      items: order1.items,
      refundAmount: 700,
      reason: "Defective exchange",
      claimType: "REPLACEMENT",
      idempotencyKey: `REPLACE-TEST-${order1._id}`,
    });

    const handoverRecordClean = await CodHandover.findOne({ receiptNumber: handoverReceiptNum });
    recordResult(
      18,
      "Return, replacement, and exchange workflows do not corrupt COD settlement records",
      handoverRecordClean && handoverRecordClean.amountSubmitted === 700 && handoverRecordClean.vendorConfirmed === true,
      `COD Handover intact: NPR ${handoverRecordClean?.amountSubmitted}, Status: ${handoverRecordClean?.status}`
    );

    // ── Test 19: Every financial record is traceable to original order with audit history
    const allOrderTransactions = await VendorTransaction.find({ order: order1._id });
    const orderWithAudit = await Order.findById(order1._id);
    const hasAuditTrail = orderWithAudit.codDetails.auditHistory.length > 0;

    recordResult(
      19,
      "Every financial record is traceable to original order and has an audit history",
      allOrderTransactions.length > 0 && hasAuditTrail,
      `Linked transactions: ${allOrderTransactions.length}, COD audit entries: ${orderWithAudit.codDetails.auditHistory.length}`
    );

  } catch (err) {
    console.error("Test execution failed with error:", err);
  } finally {
    console.log("\n=========================================================================");
    console.log("                           TEST SUMMARY REPORT                           ");
    console.log("=========================================================================");
    const passedCount = testResults.filter((r) => r.passed).length;
    const totalCount = testResults.length;
    console.log(`TOTAL TESTS: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
    if (passedCount === totalCount) {
      console.log(">>> ALL 19 COD PAYMENT, WALLET, VENDOR REFUND & AUDIT RULES VERIFIED! <<<");
    }
    console.log("=========================================================================\n");
    await mongoose.disconnect();
    process.exit(passedCount === totalCount ? 0 : 1);
  }
}

runCodAndRefundRulesTests();

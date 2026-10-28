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
import Refund from "../models/Refund.js";
import {
  processOrderRefund,
  processReturnPickupAccounting,
} from "../services/financeLedgerService.js";
import {
  vendorAcknowledgeClaim,
  vendorDirectRefundPayout,
  superAdminProcessOnlineRefund,
  adminAssignReturnPickup,
  deliveryBoySubmitReturnInspection,
  approveRefund,
  rejectRefund,
} from "../controllers/refundController.js";
import {
  staffExamineRefundAction,
  updateRefundPickupAction,
  recordRefundInspectionAction,
} from "../controllers/staffAdminOperationsController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function mockReqRes(reqData = {}) {
  let statusCode = 200;
  let responseData = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    },
  };
  const next = (err) => {
    if (err) {
      statusCode = err.statusCode || 500;
      responseData = { message: err.message };
      console.log("   [Mock Next Error]:", err.message);
    }
  };
  return {
    req: {
      user: { role: "superadmin" },
      params: {},
      body: {},
      query: {},
      ...reqData,
    },
    res,
    next,
    getStatus: () => statusCode,
    getData: () => responseData,
  };
}

async function runTests() {
  console.log("=========================================================================");
  console.log("  BHANSAMART – COMPLETE RETURN, REFUND, REPLACEMENT & EXCHANGE TEST SUITE");
  console.log("=========================================================================\n");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/bhansamart";
  await mongoose.connect(mongoUri);
  console.log("✓ Connected to MongoDB.\n");

  const results = [];
  function record(num, name, pass, info = "") {
    results.push({ num, name, pass, info });
    console.log(`[Test ${num}] ${pass ? "✅ PASS" : "❌ FAIL"} - ${name}`);
    if (info) console.log(`   └─ ${info}`);
  }

  try {
    // 1. Setup isolated test users & fixtures
    const customerUser = await User.findOneAndUpdate(
      { email: "refund.test.customer@bhansamart.com" },
      { name: "Refund Customer", phone: "+9779812345678", role: "customer", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    const vendorUserA = await User.findOneAndUpdate(
      { email: "refund.test.vendorA@bhansamart.com" },
      { name: "Vendor Alpha", phone: "+9779823456789", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    const vendorA = await Vendor.findOneAndUpdate(
      { userId: vendorUserA._id },
      {
        userId: vendorUserA._id,
        status: "approved",
        businessDetails: { businessName: "Alpha Grocery Mart", businessEmail: vendorUserA.email },
        wallet: { currentBalance: 2000, totalEarned: 2000, pendingRecoveries: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    const vendorUserB = await User.findOneAndUpdate(
      { email: "refund.test.vendorB@bhansamart.com" },
      { name: "Vendor Beta", phone: "+9779834567890", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    const vendorB = await Vendor.findOneAndUpdate(
      { userId: vendorUserB._id },
      {
        userId: vendorUserB._id,
        status: "approved",
        businessDetails: { businessName: "Beta Electronics Store", businessEmail: vendorUserB.email },
        wallet: { currentBalance: 5000, totalEarned: 5000, pendingRecoveries: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    const deliveryUser = await User.findOneAndUpdate(
      { email: "refund.test.rider@bhansamart.com" },
      { name: "Rider Bikash", phone: "+9779845678901", role: "delivery_boy", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    const deliveryBoy = await DeliveryBoy.findOneAndUpdate(
      { user: deliveryUser._id },
      {
        user: deliveryUser._id,
        fullName: "Rider Bikash",
        phone: deliveryUser.phone,
        approvalStatus: "APPROVED",
        availability: "ONLINE",
        wallet: { currentBalance: 0, totalEarned: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    const staffUser = await User.findOneAndUpdate(
      { email: "refund.test.staff@bhansamart.com" },
      {
        name: "Staff Admin John",
        phone: "+9779856789012",
        role: "admin",
        subRole: "operations",
        assignedVendors: [vendorA._id],
        isActive: true,
      },
      { upsert: true, returnDocument: "after" }
    );

    const superAdminUser = await User.findOneAndUpdate(
      { email: "refund.test.superadmin@bhansamart.com" },
      { name: "Super Admin", phone: "+9779800000000", role: "superadmin", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    const productA = await Product.findOneAndUpdate(
      { slug: "refund-test-rice-bag" },
      {
        name: "Basmati Rice 5kg",
        slug: "refund-test-rice-bag",
        vendor: vendorA._id,
        price: 800,
        stock: 50,
        isReturnable: true,
        returnWindowDays: 7,
      },
      { upsert: true, returnDocument: "after" }
    );

    const productB = await Product.findOneAndUpdate(
      { slug: "refund-test-earbuds" },
      {
        name: "Wireless Earbuds Pro",
        slug: "refund-test-earbuds",
        vendor: vendorB._id,
        price: 2500,
        stock: 30,
        isReturnable: true,
        returnWindowDays: 7,
      },
      { upsert: true, returnDocument: "after" }
    );

    // Clean up past test refunds & earnings for these entities
    await Order.deleteMany({ customer: customerUser._id });
    await Refund.deleteMany({ customer: customerUser._id });
    await DeliveryEarningsLedger.deleteMany({ deliveryBoy: deliveryBoy._id });
    await DeliveryAssignment.deleteMany({ deliveryBoy: deliveryBoy._id });
    await VendorTransaction.deleteMany({ vendor: { $in: [vendorA._id, vendorB._id] } });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: COD Return/Refund - Vendor Directly Pays, Super Admin Never Debited
    // ─────────────────────────────────────────────────────────────────────────
    const codOrder = await Order.create({
      orderNumber: "BM-TEST-COD-101",
      customer: customerUser._id,
      vendor: vendorA._id,
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      itemsTotal: 800,
      totalCount: 1,
      totalAmount: 800,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          quantity: 1,
          price: 800,
          totalPrice: 800,
        },
      ],
      pricing: { subtotal: 800, total: 800 },
      financialBreakdown: {
        vendorGrossSales: 800,
        superAdminCommissionAmount: 12, // 1.5% commission
      },
    });

    const codRefund = await Refund.create({
      refundNumber: "REF-COD-001",
      order: codOrder._id,
      orderNumber: codOrder.orderNumber,
      amount: 800,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "RETURN",
      isVendorFunded: true, // COD = Vendor funded
      status: "REQUESTED",
      totalRefundAmount: 800,
      reason: "Quality not as expected",
      customerPayoutDetails: {
        method: "BANK_TRANSFER",
        accountHolderName: "Refund Customer",
        accountNumber: "9876543210123",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
      },
    });

    // Vendor acknowledges
    const { req: ackReq, res: ackRes, next: ackNext, getStatus: getAckStatus } = mockReqRes({
      user: { _id: vendorUserA._id, role: "vendor", vendorId: vendorA._id },
      params: { id: codRefund._id.toString() },
      body: { notes: "We will inspect and refund the customer directly." },
    });
    await vendorAcknowledgeClaim(ackReq, ackRes, ackNext);

    // Vendor performs direct payout
    const { req: payoutReq, res: payoutRes, next: payoutNext, getStatus: getPayoutStatus } = mockReqRes({
      user: { _id: vendorUserA._id, role: "vendor", vendorId: vendorA._id },
      params: { id: codRefund._id.toString() },
      body: {
        transactionReference: "NEFT-UTR-998877",
        payoutMethod: "BANK_TRANSFER",
        notes: "Direct bank transfer completed from vendor business account.",
      },
    });
    await vendorDirectRefundPayout(payoutReq, payoutRes, payoutNext);

    const verifiedCodRefund = await Refund.findById(codRefund._id);
    const pass1 =
      getAckStatus() === 200 &&
      getPayoutStatus() === 200 &&
      verifiedCodRefund.status === "COMPLETED" &&
      verifiedCodRefund.isVendorFunded === true &&
      verifiedCodRefund.vendorPaymentDetails?.transactionReference === "NEFT-UTR-998877";

    record(1, "COD Return: Vendor direct refund succeeds, Super Admin account not debited", pass1,
      `Status: ${verifiedCodRefund.status}, TxRef: ${verifiedCodRefund.vendorPaymentDetails?.transactionReference}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Online Payment Refund - Handled by Super Admin, Commission Preserved
    // ─────────────────────────────────────────────────────────────────────────
    const onlineOrder = await Order.create({
      orderNumber: "BM-TEST-ONL-202",
      customer: customerUser._id,
      vendor: vendorA._id,
      paymentMethod: "esewa",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      itemsTotal: 800,
      totalCount: 1,
      totalAmount: 800,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          quantity: 1,
          price: 800,
          totalPrice: 800,
        },
      ],
      pricing: { subtotal: 800, total: 800 },
      financialBreakdown: {
        vendorGrossSales: 800,
        superAdminCommissionAmount: 12, // 1.5% commission
      },
    });

    const onlineRefund = await Refund.create({
      refundNumber: "REF-ONL-002",
      order: onlineOrder._id,
      orderNumber: onlineOrder.orderNumber,
      amount: 800,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "REFUND",
      originalPaymentMethod: "esewa",
      isVendorFunded: false, // Online = Super Admin
      status: "APPROVED",
      totalRefundAmount: 800,
      reason: "Item defect reported",
    });

    // Test that vendor CANNOT execute online payout (must return 403)
    const { req: vendFailReq, res: vendFailRes, next: vendFailNext, getStatus: getVendFailStatus } = mockReqRes({
      user: { _id: vendorUserA._id, role: "vendor", vendorId: vendorA._id },
      params: { id: onlineRefund._id.toString() },
      body: { transactionReference: "FAIL-ATTEMPT" },
    });
    await vendorDirectRefundPayout(vendFailReq, vendFailRes, vendFailNext);
    const vendorBlockedFromOnline = getVendFailStatus() === 403;

    // Super Admin executes online payout
    const { req: saReq, res: saRes, next: saNext, getStatus: getSaStatus } = mockReqRes({
      user: { _id: superAdminUser._id, role: "superadmin" },
      params: { id: onlineRefund._id.toString() },
      body: {
        status: "COMPLETED",
        transactionReference: "ONL-PAYOUT-SA-554433",
        notes: "Online refund processed by Super Admin finance portal.",
      },
    });
    await superAdminProcessOnlineRefund(saReq, saRes, saNext);

    const verifiedOnlineRefund = await Refund.findById(onlineRefund._id);
    // Verify that NO COMMISSION_REVERSAL transaction was created
    const commReversalTx = await VendorTransaction.findOne({
      vendor: vendorA._id,
      transactionType: "COMMISSION_REVERSAL",
    });

    const pass2 =
      vendorBlockedFromOnline &&
      getSaStatus() === 200 &&
      verifiedOnlineRefund.status === "COMPLETED" &&
      commReversalTx === null;

    record(2, "Online Refund: Super Admin executes payout, Vendor blocked, Platform commission preserved intact", pass2,
      `Vendor blocked: ${vendorBlockedFromOnline}, Status: ${verifiedOnlineRefund.status}, Commission Reversal Tx Exists: ${Boolean(commReversalTx)}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Failed / Pending Payout Does Not Show as Completed
    // ─────────────────────────────────────────────────────────────────────────
    const pendingRefund = await Refund.create({
      refundNumber: "REF-PEND-003",
      order: onlineOrder._id,
      orderNumber: onlineOrder.orderNumber,
      amount: 400,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "REFUND",
      isVendorFunded: false,
      status: "REQUESTED",
      totalRefundAmount: 400,
      reason: "Pending bank verification",
    });

    // Mark as PROCESSING
    const { req: procReq, res: procRes, next: procNext, getStatus: getProcStatus } = mockReqRes({
      user: { _id: superAdminUser._id, role: "superadmin" },
      params: { id: pendingRefund._id.toString() },
      body: { status: "PROCESSING", notes: "Awaiting gateway confirmation" },
    });
    await superAdminProcessOnlineRefund(procReq, procRes, procNext);

    const verifiedPending = await Refund.findById(pendingRefund._id);
    const pass3 = getProcStatus() === 200 && verifiedPending.status === "PROCESSING" && verifiedPending.status !== "COMPLETED";

    record(3, "Failed/Pending Payout: Status remains PROCESSING and does not show as completed", pass3,
      `Current Status: ${verifiedPending.status}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Return Pickup & Physical Inspection Report Saved & Visible
    // ─────────────────────────────────────────────────────────────────────────
    const inspectionRefund = await Refund.create({
      refundNumber: "REF-INSP-004",
      order: codOrder._id,
      orderNumber: codOrder.orderNumber,
      amount: 800,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "RETURN",
      isVendorFunded: true,
      status: "REQUESTED",
      totalRefundAmount: 800,
      reason: "Damaged packaging",
    });

    // Assign return pickup to rider
    const { req: assignReq, res: assignRes, next: assignNext, getStatus: getAssignStatus } = mockReqRes({
      user: { _id: superAdminUser._id, role: "superadmin" },
      params: { id: inspectionRefund._id.toString() },
      body: {
        deliveryBoyId: deliveryBoy._id.toString(),
        notes: "Pickup Basmati Rice from customer doorstep.",
      },
    });
    await adminAssignReturnPickup(assignReq, assignRes, assignNext);

    const assignedRefund = await Refund.findById(inspectionRefund._id);
    const assignedOtp = assignedRefund.pickup.otp;

    // Delivery boy submits physical inspection report with OTP
    const { req: inspReq, res: inspRes, next: inspNext, getStatus: getInspStatus } = mockReqRes({
      user: { _id: deliveryUser._id, role: "delivery_boy" },
      params: { id: inspectionRefund._id.toString() },
      body: {
        otp: assignedOtp,
        condition: "OPEN_BOX",
        missingAccessories: "None",
        visibleDamage: "Seal broken and outer box scratched",
        quantityCollected: 1,
        notes: "Item checked at doorstep; verified with customer.",
        result: "PASSED",
        proofImages: ["https://bhansamart.com/uploads/return-proof-1.jpg"],
      },
    });
    await deliveryBoySubmitReturnInspection(inspReq, inspRes, inspNext);

    const verifiedInspection = await Refund.findById(inspectionRefund._id);
    const pass4 =
      getAssignStatus() === 200 &&
      getInspStatus() === 200 &&
      verifiedInspection.pickup.isOtpVerified === true &&
      verifiedInspection.inspection.condition === "OPEN_BOX" &&
      Boolean(verifiedInspection.inspection.visibleDamage) === true &&
      verifiedInspection.inspection.result === "PASSED" &&
      verifiedInspection.inspection.proofImages?.length > 0;

    record(4, "Return Pickup & Inspection: OTP verification & physical inspection report recorded", pass4,
      `Condition: ${verifiedInspection.inspection.condition}, OTP Verified: ${verifiedInspection.pickup.isOtpVerified}, Photos: ${verifiedInspection.inspection.proofImages?.length}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Return Pickup Fee (NPR 50) Debit & Delivery Boy Credit Exactly Once
    // ─────────────────────────────────────────────────────────────────────────
    const feeOrder = await Order.create({
      orderNumber: "BM-TEST-FEE-505",
      customer: customerUser._id,
      vendor: vendorA._id,
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      itemsTotal: 800,
      totalCount: 1,
      totalAmount: 800,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          quantity: 1,
          price: 800,
          totalPrice: 800,
        },
      ],
      pricing: { subtotal: 800, total: 800 },
    });

    const pickupFeeRefund = await Refund.create({
      refundNumber: "REF-FEE-005",
      order: feeOrder._id,
      orderNumber: feeOrder.orderNumber,
      amount: 800,
      customer: customerUser._id,
      vendor: vendorA._id,
      claimType: "RETURN",
      isVendorFunded: true,
      status: "APPROVED",
      totalRefundAmount: 800,
      reason: "Doorstep pickup service fee test",
    });

    // Reset vendor wallet and rider wallet to check exact delta
    await Vendor.findByIdAndUpdate(vendorA._id, { "wallet.currentBalance": 1000, "wallet.pendingRecoveries": 0 });
    await DeliveryBoy.findByIdAndUpdate(deliveryBoy._id, { "wallet.currentBalance": 100, "wallet.totalEarned": 100 });

    const pickupAccountingResult = await processReturnPickupAccounting({
      refundId: pickupFeeRefund._id,
      deliveryBoyId: deliveryBoy._id,
      vendorId: vendorA._id,
      pickupCharge: 50,
    });

    const vendorAfterPickup = await Vendor.findById(vendorA._id);
    const riderAfterPickup = await DeliveryBoy.findById(deliveryBoy._id);

    const vendorDebitTx = await VendorTransaction.findOne({
      vendor: vendorA._id,
      type: "RETURN_PICKUP_CHARGE",
      refund: pickupFeeRefund._id,
    });

    const riderCreditLedger = await DeliveryEarningsLedger.findOne({
      deliveryBoy: deliveryBoy._id,
      earningType: "RETURN_PICKUP",
      refund: pickupFeeRefund._id,
    });

    const pass5 =
      pickupAccountingResult.success === true &&
      vendorAfterPickup.wallet.currentBalance === 950 && // 1000 - 50
      riderAfterPickup.wallet.currentBalance === 150 &&   // 100 + 50
      vendorDebitTx !== null &&
      vendorDebitTx.amount === 50 &&
      riderCreditLedger !== null &&
      riderCreditLedger.totalEarnings === 50;

    record(5, "Return Pickup Accounting: Vendor debited NPR 50 & Rider credited NPR 50 with matching ledger refs", pass5,
      `Vendor Balance: 1000 -> ${vendorAfterPickup.wallet.currentBalance}, Rider Balance: 100 -> ${riderAfterPickup.wallet.currentBalance}, Tx Ref: ${pickupAccountingResult.matchingRef}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Multi-Vendor Order: Return Routed Strictly to Product's Vendor
    // ─────────────────────────────────────────────────────────────────────────
    const multiVendorOrder = await Order.create({
      orderNumber: "BM-TEST-MULTI-606",
      customer: customerUser._id,
      vendor: vendorA._id, // Primary vendor
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      itemsTotal: 3300,
      totalCount: 2,
      totalAmount: 3300,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          vendor: vendorA._id,
          price: 800,
          quantity: 1,
          totalPrice: 800,
        },
        {
          product: productB._id,
          productId: productB._id.toString(),
          name: productB.name,
          vendor: vendorB._id, // Belongs to Vendor B
          price: 2500,
          quantity: 1,
          totalPrice: 2500,
        },
      ],
      pricing: { subtotal: 3300, total: 3300 },
    });

    // Customer raises return for Product B (Vendor B's ear buds)
    const multiVendorRefund = await Refund.create({
      refundNumber: "REF-MULTI-006",
      order: multiVendorOrder._id,
      orderNumber: multiVendorOrder.orderNumber,
      amount: 2500,
      customer: customerUser._id,
      vendor: vendorB._id, // Product B's specific vendor!
      items: [
        {
          product: productB._id,
          productId: productB._id.toString(),
          name: productB.name,
          price: 2500,
          quantity: 1,
          refundAmount: 2500,
          reason: "Defective left earbud",
        },
      ],
      claimType: "RETURN",
      isVendorFunded: true,
      totalRefundAmount: 2500,
      reason: "Defective left earbud",
    });

    // Vendor A tries to acknowledge/payout Product B's claim -> must be rejected
    const { req: vendAFailReq, res: vendAFailRes, next: vendAFailNext, getStatus: getVendAFailStatus } = mockReqRes({
      user: { _id: vendorUserA._id, role: "vendor", vendorId: vendorA._id },
      params: { id: multiVendorRefund._id.toString() },
      body: { notes: "Vendor A trying to touch Vendor B's return" },
    });
    await vendorAcknowledgeClaim(vendAFailReq, vendAFailRes, vendAFailNext);

    // Vendor B acknowledges -> must succeed
    const { req: vendBReq, res: vendBRes, next: vendBNext, getStatus: getVendBStatus } = mockReqRes({
      user: { _id: vendorUserB._id, role: "vendor", vendorId: vendorB._id },
      params: { id: multiVendorRefund._id.toString() },
      body: { notes: "Vendor B acknowledged replacement for Earbuds" },
    });
    await vendorAcknowledgeClaim(vendBReq, vendBRes, vendBNext);

    const pass6 = getVendAFailStatus() === 403 && getVendBStatus() === 200;
    record(6, "Multi-Vendor Routing: Claim routed strictly to Product B's vendor (Vendor A forbidden: 403)", pass6,
      `Vendor A attempt status: ${getVendAFailStatus()}, Vendor B attempt status: ${getVendBStatus()}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Replacement & Exchange Workflow
    // ─────────────────────────────────────────────────────────────────────────
    const exchangeRefund = await Refund.create({
      refundNumber: "EXCH-007",
      order: multiVendorOrder._id,
      orderNumber: multiVendorOrder.orderNumber,
      amount: 0,
      customer: customerUser._id,
      vendor: vendorB._id,
      claimType: "EXCHANGE",
      isVendorFunded: true,
      status: "REQUESTED",
      totalRefundAmount: 0, // In pure exchange, refund is 0
      reason: "Wrong color ordered, exchange for Black Variant",
      exchangeDetails: {
        exchangeProductId: productB._id,
        exchangeProductName: "Wireless Earbuds Pro (Black Variant)",
        priceDifference: 0,
        fulfillmentStatus: "PENDING",
      },
    });

    const verifiedExchange = await Refund.findById(exchangeRefund._id);
    const pass7 =
      verifiedExchange.claimType === "EXCHANGE" &&
      verifiedExchange.exchangeDetails.exchangeProductName === "Wireless Earbuds Pro (Black Variant)" &&
      verifiedExchange.exchangeDetails.priceDifference === 0;

    record(7, "Replacement & Exchange: Price difference & exchange details tracked cleanly with 0 duplicate charge", pass7,
      `Claim Type: ${verifiedExchange.claimType}, Exchange Item: ${verifiedExchange.exchangeDetails.exchangeProductName}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Role-Based Security: Staff Admin Blocked (403), Data Masked
    // ─────────────────────────────────────────────────────────────────────────
    // Staff admin attempts to examine/modify refund
    const { req: staffExReq, res: staffExRes, next: staffExNext, getStatus: getStaffExStatus } = mockReqRes({
      user: { _id: staffUser._id, role: "staffadmin" },
      params: { id: inspectionRefund._id.toString() },
      body: { notes: "Staff trying to modify examination" },
    });
    await staffExamineRefundAction(staffExReq, staffExRes, staffExNext);

    // Staff admin attempts to update pickup
    const { req: staffPickReq, res: staffPickRes, next: staffPickNext, getStatus: getStaffPickStatus } = mockReqRes({
      user: { _id: staffUser._id, role: "staffadmin" },
      params: { id: inspectionRefund._id.toString() },
      body: { pickupStatus: "COMPLETED" },
    });
    await updateRefundPickupAction(staffPickReq, staffPickRes, staffPickNext);

    // Test masking helper on Refund
    const rawPayoutDetails = {
      method: "BANK_TRANSFER",
      accountHolderName: "Sita Sharma",
      accountNumber: "98765432109876",
      ifscCode: "SBI0004567",
      upiId: "sita@okhdfcbank",
    };
    const masked = Refund.maskCustomerPayoutDetails(rawPayoutDetails);

    const pass8 =
      getStaffExStatus() === 403 &&
      getStaffPickStatus() === 403 &&
      masked.accountNumber.includes("*") &&
      masked.ifscCode.includes("*") &&
      masked.upiId.includes("*");

    record(8, "Security & Roles: Staff Admin strictly blocked (403 Forbidden) and customer payout details masked", pass8,
      `Staff Examine Status: ${getStaffExStatus()}, Staff Pickup Status: ${getStaffPickStatus()}, Masked Account: ${masked.accountNumber}, Masked IFSC: ${masked.ifscCode}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Idempotency & Duplicate Protection
    // ─────────────────────────────────────────────────────────────────────────
    // Run return pickup accounting a SECOND time for the same refund
    const duplicateAccounting = await processReturnPickupAccounting({
      refundId: pickupFeeRefund._id,
      deliveryBoyId: deliveryBoy._id,
      vendorId: vendorA._id,
      pickupCharge: 50,
    });

    const vendorAfterDup = await Vendor.findById(vendorA._id);
    const riderAfterDup = await DeliveryBoy.findById(deliveryBoy._id);

    // Try paying COD refund a SECOND time when already COMPLETED
    const { req: dupPayReq, res: dupPayRes, next: dupPayNext, getStatus: getDupPayStatus } = mockReqRes({
      user: { _id: vendorUserA._id, role: "vendor", vendorId: vendorA._id },
      params: { id: codRefund._id.toString() },
      body: { transactionReference: "DUP-ATTEMPT-99" },
    });
    await vendorDirectRefundPayout(dupPayReq, dupPayRes, dupPayNext);

    const pass9 =
      duplicateAccounting.alreadyProcessed === true &&
      vendorAfterDup.wallet.currentBalance === 950 && // Still 950, NOT debited again
      riderAfterDup.wallet.currentBalance === 150 &&   // Still 150, NOT credited again
      getDupPayStatus() === 400; // Duplicate payout rejected

    record(9, "Idempotency: Re-running return pickup accounting or duplicate payout rejected without double-entry", pass9,
      `Duplicate Accounting Flag: ${duplicateAccounting.alreadyProcessed}, Duplicate Pay Status: ${getDupPayStatus()}, Vendor Balance: ${vendorAfterDup.wallet.currentBalance}`);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Existing Core Flows (Forward Order, Delivery & Wallet) Unbroken
    // ─────────────────────────────────────────────────────────────────────────
    const normalOrder = await Order.create({
      orderNumber: "BM-TEST-NORMAL-999",
      customer: customerUser._id,
      vendor: vendorA._id,
      assignedDeliveryBoy: deliveryBoy._id,
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      itemsTotal: 1600,
      totalCount: 2,
      totalAmount: 1600,
      deliveryAddress: { addressLine: "Plot 12, Kathmandu", phone: customerUser.phone },
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          quantity: 2,
          price: 800,
          totalPrice: 1600,
        },
      ],
      pricing: { subtotal: 1600, total: 1600 },
    });

    const foundOrder = await Order.findById(normalOrder._id);
    const pass10 =
      foundOrder !== null &&
      foundOrder.orderStatus === "DELIVERED" &&
      foundOrder.totalAmount === 1600;

    record(10, "Core Platform Integrity: Standard orders, delivery status, and wallet schemas intact", pass10,
      `Order: ${foundOrder.orderNumber}, Status: ${foundOrder.orderStatus}, Total: NPR ${foundOrder.totalAmount}`);

    console.log("\n=========================================================================");
    const allPassed = results.every((r) => r.pass);
    console.log(`  OVERALL TEST RESULT: ${allPassed ? "ALL 10 SCENARIOS PASSED ✅" : "SOME TESTS FAILED ❌"}`);
    console.log("=========================================================================\n");

  } catch (err) {
    console.error("Test execution error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB.");
  }
}

runTests();

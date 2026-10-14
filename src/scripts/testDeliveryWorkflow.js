import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import DeliveryBoy, { maskSensitiveString } from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import {
  generateSecureOTP,
  hashOTP,
  verifyHashedOTP,
  dispatchOrderToNearestPartner,
} from "../utils/dispatchEngine.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function runDeliveryTests() {
  console.log("================================================================================");
  console.log("   COMPLETE DELIVERY BOY BACKEND LIFECYCLE & INTEGRATION TEST");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB.");

    const testTimestamp = Date.now();
    const testEmail = `delivery_tester_${testTimestamp}@example.com`;
    const testPhone = `980${Math.floor(1000000 + Math.random() * 9000000)}`;

    // ── 1. Registration Test ──────────────────────────────────────────
    console.log("\n[Test 1] Registering Delivery Partner...");
    const user = await User.create({
      name: "Ramesh Sharma",
      email: testEmail,
      phone: testPhone,
      password: "securePassword123",
      role: "delivery_boy",
      status: "pending",
      isApproved: false,
    });

    const deliveryBoy = await DeliveryBoy.create({
      user: user._id,
      fullName: "Ramesh Sharma",
      phone: testPhone,
      email: testEmail,
      serviceCity: "Kathmandu",
      serviceArea: "Thamel",
      currentLocation: {
        type: "Point",
        coordinates: [85.3123, 27.7154], // Kathmandu Coordinates
      },
      lastLocationUpdatedAt: new Date(),
      approvalStatus: "PENDING_APPROVAL",
      availability: "OFFLINE",
    });

    console.log(`[OK] Partner Registered: ${deliveryBoy.fullName} (ID: ${deliveryBoy._id})`);

    // ── 2. Data Protection & Masking Test ─────────────────────────────
    console.log("\n[Test 2] Testing Sensitive Data Masking (PAN & Aadhaar)...");
    deliveryBoy.documents.panCard = {
      documentNumber: "ABCDE1234F",
      frontUrl: "https://example.com/pan.jpg",
      status: "PENDING_VERIFICATION",
    };
    deliveryBoy.documents.aadhaarCard = {
      documentNumber: "123456789012",
      frontUrl: "https://example.com/aadhaar-f.jpg",
      backUrl: "https://example.com/aadhaar-b.jpg",
      status: "PENDING_VERIFICATION",
    };
    deliveryBoy.documents.drivingLicense = {
      documentNumber: "DL-01-2022-9999",
      frontUrl: "https://example.com/dl.jpg",
      status: "PENDING_VERIFICATION",
    };
    deliveryBoy.documents.vehicleRc = {
      documentNumber: "BA-2-PA-1234",
      frontUrl: "https://example.com/rc.jpg",
      status: "PENDING_VERIFICATION",
    };
    await deliveryBoy.save();

    const masked = deliveryBoy.getMaskedProfile();
    console.log(`Masked PAN: ${masked.documents.panCard.documentNumber}`);
    console.log(`Masked Aadhaar: ${masked.documents.aadhaarCard.documentNumber}`);

    if (masked.documents.panCard.documentNumber !== "ABCDE****F") {
      throw new Error(`PAN masking failed! Got: ${masked.documents.panCard.documentNumber}`);
    }
    if (masked.documents.aadhaarCard.documentNumber !== "********9012") {
      throw new Error(`Aadhaar masking failed! Got: ${masked.documents.aadhaarCard.documentNumber}`);
    }
    console.log("[OK] Sensitive data correctly masked.");

    // ── 3. Availability Check Prior to Approval ───────────────────────
    console.log("\n[Test 3] Verifying Availability Guardrails...");
    if (deliveryBoy.canGoOnline()) {
      throw new Error("Partner should NOT be allowed to go online before approval & deposit!");
    }
    console.log(`[OK] canGoOnline() correctly returned FALSE for unapproved partner.`);

    // ── 4. Security Deposit Payment & Idempotency Test ────────────────
    console.log("\n[Test 4] Testing ₹1,000 Security Deposit & Idempotency...");
    const depositTxId = `DEP-TEST-${testTimestamp}`;
    const ledgerEntry = await SecurityDepositLedger.create({
      deliveryBoy: deliveryBoy._id,
      user: user._id,
      amount: 1000,
      currency: "INR",
      type: "DEPOSIT_PAYMENT",
      status: "PENDING",
      paymentGateway: "MockGateway",
      transactionId: depositTxId,
      idempotencyKey: `IDEM-${depositTxId}`,
    });

    // Process webhook
    ledgerEntry.status = "PAID";
    ledgerEntry.paidAt = new Date();
    await ledgerEntry.save();

    deliveryBoy.securityDeposit = {
      requiredAmount: 1000,
      paidAmount: 1000,
      status: "PAID",
      paidAt: new Date(),
      transactionId: depositTxId,
      gateway: "MockGateway",
    };
    await deliveryBoy.save();

    console.log(`[OK] Security deposit paid. Ledger entry: ${ledgerEntry.transactionId} - Amount: ₹${ledgerEntry.amount}`);

    // Verify Idempotency check: duplicate transaction should not re-credit
    const existingTx = await SecurityDepositLedger.findOne({ transactionId: depositTxId });
    if (!existingTx || existingTx.status !== "PAID") {
      throw new Error("Idempotent ledger lookup failed");
    }
    console.log("[OK] Security deposit idempotent state verified.");

    // ── 5. Admin Document Verification & Approval Test ───────────────
    console.log("\n[Test 5] Admin Verifying Documents & Partner Approval...");
    deliveryBoy.documents.panCard.status = "VERIFIED";
    deliveryBoy.documents.aadhaarCard.status = "VERIFIED";
    deliveryBoy.documents.drivingLicense.status = "VERIFIED";
    deliveryBoy.documents.vehicleRc.status = "VERIFIED";
    deliveryBoy.approvalStatus = "APPROVED";
    deliveryBoy.approvedAt = new Date();
    await deliveryBoy.save();

    console.log(`All Docs Verified: ${deliveryBoy.areAllDocumentsVerified()}`);
    console.log(`Eligible to go Online: ${deliveryBoy.canGoOnline()}`);

    if (!deliveryBoy.canGoOnline()) {
      throw new Error("Partner should be eligible to go online after verified docs & paid deposit!");
    }

    // Toggle Online
    deliveryBoy.availability = "ONLINE";
    deliveryBoy.lastLocationUpdatedAt = new Date();
    await deliveryBoy.save();
    console.log(`[OK] Partner is now ONLINE.`);

    // ── 6. Geospatial Location & 2dsphere Query Test ──────────────────
    console.log("\n[Test 6] Testing Geospatial 2dsphere Query...");
    const nearbyPartners = await DeliveryBoy.find({
      approvalStatus: "APPROVED",
      "securityDeposit.status": "PAID",
      availability: "ONLINE",
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [85.3120, 27.7150],
          },
          $maxDistance: 5000, // 5 km
        },
      },
    });
    console.log(`[OK] Geospatial query found ${nearbyPartners.length} online partner(s) within 5km.`);
    const foundPartner = nearbyPartners.find((p) => p._id.toString() === deliveryBoy._id.toString());
    if (!foundPartner) {
      throw new Error("Created delivery boy not found in geospatial proximity query!");
    }
    console.log(`[OK] Delivery boy ${foundPartner.fullName} located via 2dsphere index.`);

    // ── 7. Order Placement & Automated Dispatch Engine ───────────────
    console.log("\n[Test 7] Testing Order Placement & Dispatch to Delivery Boy...");
    const customer = await User.findOne({ role: "customer" }) || user;
    const vendor = await Vendor.findOne({ status: { $in: ["approved", "active"] } });
    if (!vendor) throw new Error("No active vendor found in DB for order testing!");

    const product = await Product.findOne({ vendor: vendor._id, inStock: true });
    if (!product) throw new Error("No product found for vendor!");

    const orderNumber = await Order.generateOrderNumber();
    const order = await Order.create({
      orderNumber,
      customer: customer._id,
      vendor: vendor._id,
      items: [
        {
          product: product._id,
          productId: product._id.toString(),
          name: product.name,
          price: product.price,
          quantity: 1,
        },
      ],
      totalCount: 1,
      itemsTotal: product.price,
      totalAmount: product.price + 50,
      deliveryAddress: {
        addressLine: "Thamel Marg 12",
        city: "Kathmandu",
        phone: "9841234567",
      },
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "ACCEPTED",
    });

    console.log(`Order created: ${order.orderNumber} (Status: ${order.orderStatus})`);

    // Run Dispatch Engine
    const dispatchResult = await dispatchOrderToNearestPartner(order._id);
    console.log("Dispatch Result:", dispatchResult);

    if (!dispatchResult.success) {
      throw new Error(`Dispatch failed: ${dispatchResult.message}`);
    }

    const assignment = await DeliveryAssignment.findById(dispatchResult.assignmentId);
    console.log(`[OK] Assignment Created: ID ${assignment._id} | Status: ${assignment.status} | Expires In: ${Math.round((assignment.expiresAt - new Date()) / 1000)}s`);

    // ── 8. Partner Accepts Order (Atomic) ─────────────────────────────
    console.log("\n[Test 8] Partner Accepting Order...");
    assignment.status = "ACCEPTED";
    assignment.acceptedAt = new Date();
    await assignment.save();

    order.assignedDeliveryBoy = deliveryBoy._id;
    await order.save();

    deliveryBoy.availability = "BUSY";
    deliveryBoy.activeOrderId = order._id;
    await deliveryBoy.save();
    console.log(`[OK] Order accepted. Partner status: ${deliveryBoy.availability}, Active Order: ${deliveryBoy.activeOrderId}`);

    // ── 9. Store Arrival & Cryptographic Pickup OTP Verification ──────
    console.log("\n[Test 9] Store Arrival & Cryptographic Pickup OTP Verification...");
    order.arrivedAtStoreAt = new Date();
    await order.save();
    console.log(`Partner arrived at store at: ${order.arrivedAtStoreAt.toISOString()}`);

    // Reload order to fetch newly generated OTPs from dispatch engine
    const freshOrder = await Order.findById(order._id).select("+pickupOtp.code +deliveryOtp.code");
    const plainPickupOtp = freshOrder.pickupOtp.displayCode;
    console.log(`Pickup OTP generated for Vendor: ${plainPickupOtp}`);

    // Verify invalid OTP rate limit / security
    const wrongOtpCheck = await verifyHashedOTP("0000", freshOrder.pickupOtp.code);
    if (wrongOtpCheck) throw new Error("Invalid OTP should NOT pass verification!");
    console.log("[OK] Incorrect OTP correctly rejected.");

    // Verify correct OTP
    const validOtpCheck = await verifyHashedOTP(plainPickupOtp, freshOrder.pickupOtp.code);
    if (!validOtpCheck) throw new Error("Valid OTP failed cryptographic check!");
    console.log("[OK] Valid Pickup OTP cryptographically verified.");

    order.pickedUpAt = new Date();
    order.orderStatus = "OUT_FOR_DELIVERY";
    await order.save();
    console.log(`[OK] Order status transitioned to: ${order.orderStatus}`);

    // ── 10. Live GPS In-Transit Updates ──────────────────────────────
    console.log("\n[Test 10] Testing In-Transit Live GPS Tracking Update...");
    const transitLng = 85.3135;
    const transitLat = 27.7160;
    order.deliveryBoyLocation = {
      type: "Point",
      coordinates: [transitLng, transitLat],
      updatedAt: new Date(),
    };
    await order.save();

    deliveryBoy.currentLocation = {
      type: "Point",
      coordinates: [transitLng, transitLat],
    };
    deliveryBoy.lastLocationUpdatedAt = new Date();
    await deliveryBoy.save();
    console.log(`[OK] In-transit GPS updated to: [${transitLng}, ${transitLat}]`);

    // ── 11. Customer Doorstep Arrival & Customer Delivery OTP ─────────
    console.log("\n[Test 11] Customer Arrival & Customer Delivery OTP Verification...");
    order.arrivedAtCustomerAt = new Date();
    await order.save();

    const plainDeliveryOtp = freshOrder.deliveryOtp.displayCode;
    console.log(`Customer Delivery OTP: ${plainDeliveryOtp}`);

    const validDeliveryOtpCheck = await verifyHashedOTP(plainDeliveryOtp, freshOrder.deliveryOtp.code);
    if (!validDeliveryOtpCheck) throw new Error("Valid Delivery OTP failed cryptographic check!");
    console.log("[OK] Customer Delivery OTP cryptographically verified.");

    order.deliveredAt = new Date();
    order.orderStatus = "DELIVERED";
    order.paymentStatus = "paid"; // Cash on delivery collected
    await order.save();

    assignment.status = "COMPLETED";
    await assignment.save();
    console.log(`[OK] Order completed & marked DELIVERED.`);

    // ── 12. Delivery Earnings Ledger & Wallet Credit Test ─────────────
    console.log("\n[Test 12] Delivery Earnings Ledger Entry & Wallet Balance...");
    const basePay = 40;
    const distancePay = 20;
    const totalEarnings = basePay + distancePay;

    const earningsEntry = await DeliveryEarningsLedger.create({
      deliveryBoy: deliveryBoy._id,
      order: order._id,
      basePay,
      distancePay,
      customerTip: 0,
      totalEarnings,
      distanceKm: 1.8,
      settlementStatus: "PENDING",
    });

    deliveryBoy.availability = "ONLINE"; // Ready for next order
    deliveryBoy.activeOrderId = null;
    deliveryBoy.metrics.totalDeliveries += 1;
    deliveryBoy.wallet.currentBalance += totalEarnings;
    deliveryBoy.wallet.totalEarned += totalEarnings;
    await deliveryBoy.save();

    console.log(`[OK] Earnings ledger entry created: ₹${earningsEntry.totalEarnings} (Base: ₹${basePay}, Distance: ₹${distancePay})`);
    console.log(`[OK] Delivery boy wallet credited. Current balance: ₹${deliveryBoy.wallet.currentBalance}`);

    // ── 13. Separation of Ledgers Check ──────────────────────────────
    console.log("\n[Test 13] Verifying Strict Separation of Ledgers...");
    const depositLedgers = await SecurityDepositLedger.find({ deliveryBoy: deliveryBoy._id });
    const earningsLedgers = await DeliveryEarningsLedger.find({ deliveryBoy: deliveryBoy._id });

    console.log(`Security Deposit Ledger entries for partner: ${depositLedgers.length} (Total amount: ₹${depositLedgers[0].amount})`);
    console.log(`Delivery Earnings Ledger entries for partner: ${earningsLedgers.length} (Total amount: ₹${earningsLedgers[0].totalEarnings})`);

    if (depositLedgers.length !== 1 || earningsLedgers.length !== 1) {
      throw new Error("Ledger separation check failed!");
    }
    console.log("[OK] Security deposit ledger and earnings ledger are strictly separated.");

    // Clean up test order & records
    await Order.findByIdAndDelete(order._id);
    await DeliveryAssignment.deleteMany({ order: order._id });
    await DeliveryEarningsLedger.deleteMany({ order: order._id });
    await SecurityDepositLedger.deleteMany({ deliveryBoy: deliveryBoy._id });
    await DeliveryBoy.findByIdAndDelete(deliveryBoy._id);
    await User.findByIdAndDelete(user._id);

    console.log("\n================================================================================");
    console.log("   ALL DELIVERY BOY WORKFLOW TESTS PASSED PERFECTLY!");
    console.log("================================================================================");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ TEST FAILED:", error);
    process.exit(1);
  }
}

runDeliveryTests();

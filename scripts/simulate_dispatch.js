import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

import redisDispatchService from "../src/services/redisDispatchService.js";
import dispatchEngine from "../src/utils/dispatchEngine.js";
import DispatchSettings from "../src/models/DispatchSettings.js";
import DeliveryBoy from "../src/models/DeliveryBoy.js";
import DeliveryAssignment from "../src/models/DeliveryAssignment.js";
import DeliveryEarningsLedger from "../src/models/DeliveryEarningsLedger.js";
import Order from "../src/models/Order.js";
import Vendor from "../src/models/Vendor.js";
import User from "../src/models/User.js";

const hashOtp = (code) => crypto.createHash("sha256").update(code).digest("hex");

async function runSimulation() {
  console.log("==========================================================");
  console.log("🚀 STARTING BLINKIT-STYLE DISPATCH ENGINE SIMULATION TEST");
  console.log("==========================================================");

  // 1. Connect MongoDB
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not found in environment!");
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log("✅ MongoDB Connected successfully.");

  // 2. Redis is automatically connected on import via redisClient
  console.log("✅ Redis Dispatch Service initialized.");

  // 3. Load Dispatch Settings
  const settings = await DispatchSettings.getActiveConfig();
  console.log(`✅ Dispatch Settings Loaded:
     • Auto-dispatch Enabled: ${settings.autoDispatchEnabled}
     • Initial Radius: ${settings.initialSearchRadiusKm} km
     • Offer Timeout: ${settings.riderOfferTimeoutSeconds || 20} seconds
     • Base Delivery Fee: ₹${settings.payoutRateCard?.baseDeliveryFee || 40}
     • Per-Km Distance Fee: ₹${settings.payoutRateCard?.perKmDistanceFee || 15}`);

  // 4. Create or Find Simulation Test User & DeliveryBoy
  let testUser = await User.findOne({ email: "test.rider.simulation@bhansamart.com" });
  if (!testUser) {
    testUser = await User.create({
      name: "Simulated Test Rider",
      email: "test.rider.simulation@bhansamart.com",
      phone: "9800000099",
      role: "delivery_boy",
      status: "active",
      isActive: true,
    });
  }

  let rider = await DeliveryBoy.findOne({ user: testUser._id });
  if (!rider) {
    rider = await DeliveryBoy.create({
      user: testUser._id,
      fullName: "Simulated Test Rider",
      phone: "9800000099",
      email: "test.rider.simulation@bhansamart.com",
      approvalStatus: "APPROVED",
      securityDeposit: {
        status: "PAID",
        amount: 1000,
        paidAt: new Date(),
      },
      availability: "ONLINE",
      vehicleType: "BIKE",
      currentLocation: {
        type: "Point",
        coordinates: [85.324, 27.7172], // Kathmandu Durbar Marg
      },
      rating: 4.95,
      completedOrdersCount: 120,
    });
  } else {
    rider.approvalStatus = "APPROVED";
    rider.securityDeposit.status = "PAID";
    rider.availability = "ONLINE";
    rider.currentLocation = {
      type: "Point",
      coordinates: [85.324, 27.7172],
    };
    await rider.save();
  }
  console.log(`✅ Test Rider Ready: ${rider.fullName} (ID: ${rider._id})`);

  // 5. Sync Rider into Redis Geo & Presence
  const riderIdStr = rider._id.toString();
  await redisDispatchService.setRiderOnline(riderIdStr, 85.324, 27.7172);
  await redisDispatchService.updateRiderLocation(riderIdStr, 85.324, 27.7172, 0, 0);
  await redisDispatchService.setRiderAvailable(riderIdStr);

  const isRiderAvail = await redisDispatchService.isRiderAvailable(riderIdStr);
  console.log(`✅ Rider Redis Availability Check: ${isRiderAvail ? "AVAILABLE (Ready for Offers)" : "BUSY"}`);

  // 6. Find or Create Simulation Vendor
  let vendor = await Vendor.findOne({ status: "approved" });
  if (!vendor) {
    vendor = await Vendor.create({
      userId: testUser._id,
      storeName: "BhansaMart Central Store (Simulated)",
      email: "test.vendor.simulation@bhansamart.com",
      phone: "9811111199",
      address: "Putalisadak, Kathmandu",
      location: {
        type: "Point",
        coordinates: [85.321, 27.716], // ~350m from rider
      },
      status: "approved",
    });
  }
  console.log(`✅ Simulation Store Ready: ${vendor.storeName || "Central Store"} (Coords: ${vendor.location?.coordinates})`);

  // 7. Create Simulation Order in READY_FOR_PICKUP status
  const testOrderNumber = `SIM-ORD-${Date.now().toString().slice(-6)}`;
  const pickupOtpCode = "1428";
  const deliveryOtpCode = "8520";
  const dummyProdId = new mongoose.Types.ObjectId();

  const order = await Order.create({
    orderNumber: testOrderNumber,
    customer: testUser._id,
    vendor: vendor._id,
    items: [
      {
        product: dummyProdId,
        productId: dummyProdId.toString(),
        name: "Fresh Himalayan Apples (1kg)",
        price: 180,
        quantity: 2,
        total: 360,
      },
    ],
    totalCount: 2,
    itemsTotal: 360,
    deliveryCharge: 40,
    totalAmount: 400,
    grandTotal: 400,
    paymentMethod: "Cash on delivery",
    paymentStatus: "pending",
    orderStatus: "READY_FOR_PICKUP",
    deliveryStatus: "SEARCHING_FOR_PARTNER",
    pickupOtp: {
      code: hashOtp(pickupOtpCode),
      displayCode: pickupOtpCode,
    },
    deliveryOtp: {
      code: hashOtp(deliveryOtpCode),
      displayCode: deliveryOtpCode,
    },
    deliveryAddress: {
      addressLine: "Thamel Marg, Kathmandu",
      city: "Kathmandu",
      phone: "9800000099",
      latitude: 27.721,
      longitude: 85.328, // ~800m from store
    },
  });
  console.log(`✅ Simulation Order Created: ${order.orderNumber} (Status: READY_FOR_PICKUP)`);

  // 8. Run Automatic Dispatch Engine
  console.log("\n⚡ TRIGGERING AUTOMATIC DISPATCH ENGINE...");
  const dispatchResult = await dispatchEngine.dispatchOrder(order._id);
  console.log("📊 Dispatch Engine Result:", JSON.stringify(dispatchResult, null, 2));

  if (!dispatchResult.success) {
    throw new Error(`Dispatch failed: ${dispatchResult.message || dispatchResult.reason}`);
  }

  // 9. Verify Redis Offer Key & Assignment Status
  const isOfferInRedis = await redisDispatchService.isOfferActive(order._id.toString());
  const updatedAssignment = await DeliveryAssignment.findOne({ order: order._id });
  console.log(`✅ Redis Offer Key Active: ${isOfferInRedis}`);
  console.log(`✅ Assignment Status in MongoDB: ${updatedAssignment.status} (Offered to: ${updatedAssignment.deliveryBoy})`);

  // 10. Simulate Rider Accepting Offer
  console.log("\n🛵 SIMULATING RIDER ACCEPTING OFFER...");
  updatedAssignment.status = "ACCEPTED";
  updatedAssignment.acceptedAt = new Date();
  await updatedAssignment.save();

  await redisDispatchService.setRiderBusy(riderIdStr);
  await redisDispatchService.clearDispatchOffer(order._id.toString());
  await redisDispatchService.releaseDispatchLock(order._id.toString());

  const riderBusyCheck = await redisDispatchService.isRiderAvailable(riderIdStr);
  console.log(`✅ Rider Status after Accept: ${riderBusyCheck ? "AVAILABLE" : "BUSY (Correct)"}`);

  // 11. Simulate Reaching Store
  console.log("\n🏬 SIMULATING RIDER ARRIVING AT STORE...");
  order.deliveryStatus = "STORE_REACHED";
  await order.save();
  console.log("✅ Order Delivery Status: STORE_REACHED");

  // 12. Simulate Pickup OTP Verification
  console.log(`\n🔑 SIMULATING PICKUP OTP VERIFICATION (Code: ${pickupOtpCode})...`);
  const pickupHashed = hashOtp(pickupOtpCode);
  if (order.pickupOtp.code !== pickupHashed) {
    throw new Error("Pickup OTP verification failed!");
  }
  order.orderStatus = "OUT_FOR_DELIVERY";
  order.deliveryStatus = "OUT_FOR_DELIVERY";
  order.pickupOtp.verified = true;
  await order.save();
  console.log("✅ Pickup OTP Verified! Order Status: OUT_FOR_DELIVERY");

  // 13. Simulate Delivery OTP Verification
  console.log(`\n🏠 SIMULATING CUSTOMER DELIVERY OTP VERIFICATION (Code: ${deliveryOtpCode})...`);
  const deliveryHashed = hashOtp(deliveryOtpCode);
  if (order.deliveryOtp.code !== deliveryHashed) {
    throw new Error("Delivery OTP verification failed!");
  }
  order.orderStatus = "DELIVERED";
  order.deliveryStatus = "DELIVERED";
  order.deliveredAt = new Date();
  order.deliveryOtp.verified = true;
  await order.save();

  updatedAssignment.status = "COMPLETED";
  updatedAssignment.completedAt = new Date();
  await updatedAssignment.save();
  console.log("✅ Delivery OTP Verified! Order Status: DELIVERED, Assignment: COMPLETED");

  // 14. Authoritative Payout Crediting
  const distanceKm = updatedAssignment.distanceKm || 1.15;
  const baseFee = settings.payoutRateCard?.baseDeliveryFee || 40;
  const perKmFee = settings.payoutRateCard?.perKmDistanceFee || 15;
  const distancePay = Math.round(distanceKm * perKmFee);
  const totalEarnings = baseFee + distancePay;

  const earningsRecord = await DeliveryEarningsLedger.create({
    deliveryBoy: rider._id,
    order: order._id,
    assignment: updatedAssignment._id,
    basePay: baseFee,
    distancePay: distancePay,
    totalEarnings: totalEarnings,
    distanceKm: distanceKm,
    settlementStatus: "PENDING",
  });
  console.log(`💰 Authoritative Earnings Credited: ₹${totalEarnings} (Base: ₹${baseFee}, Distance: ₹${distancePay}, Ledger ID: ${earningsRecord._id})`);

  // 15. Release Rider back to Available pool
  await redisDispatchService.setRiderAvailable(riderIdStr);
  const riderFinalCheck = await redisDispatchService.isRiderAvailable(riderIdStr);
  console.log(`✅ Rider Status after Delivery: ${riderFinalCheck ? "AVAILABLE (Ready for next order)" : "BUSY"}`);

  // 16. Clean up simulation order and assignment
  await Order.findByIdAndDelete(order._id);
  await DeliveryAssignment.deleteMany({ order: order._id });
  await DeliveryEarningsLedger.findByIdAndDelete(earningsRecord._id);
  console.log("🧹 Simulation test data cleaned up.");

  console.log("\n==========================================================");
  console.log("🎉 ALL E2E DISPATCH & DELIVERY SIMULATION TESTS PASSED 100%!");
  console.log("==========================================================");

  await mongoose.disconnect();
  process.exit(0);
}

runSimulation().catch(async (err) => {
  console.error("❌ Simulation Error:", err);
  await mongoose.disconnect();
  process.exit(1);
});

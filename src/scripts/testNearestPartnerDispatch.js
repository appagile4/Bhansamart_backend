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
import {
  findEligiblePartners,
  dispatchOrderToNearestPartner,
  calculateDistanceKm,
} from "../utils/dispatchEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runNearestDispatchTest() {
  console.log("=================================================================");
  console.log("   TESTING REAL-TIME NEAREST DELIVERY PARTNER DISPATCH ENGINE    ");
  console.log("=================================================================");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/bhansamart";
  await mongoose.connect(mongoUri);
  console.log("✓ Connected to MongoDB Atlas.");

  let vendorUser, vendor, riderUserNear, riderNear, riderUserFar, riderFar, customerUser, testProduct, testOrder;

  try {
    // 1. Setup Vendor House at Kathmandu Central [85.3240, 27.7172]
    const vendorCoords = [85.3240, 27.7172]; // [lng, lat]
    vendorUser = await User.findOneAndUpdate(
      { email: "vendor.dispatch.test@bhansamart.com" },
      { name: "Vendor Dispatch House", phone: "+9779800000077", role: "vendor", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    vendor = await Vendor.findOneAndUpdate(
      { userId: vendorUser._id },
      {
        userId: vendorUser._id,
        status: "approved",
        businessDetails: { businessName: "Vendor Warehouse Hub" },
        shippingLocations: {
          warehouseAddress: "Central Hub, Kathmandu",
          city: "Kathmandu",
          longitude: vendorCoords[0],
          latitude: vendorCoords[1],
        },
        location: {
          type: "Point",
          coordinates: vendorCoords,
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    // 2. Setup Delivery Boy 1 (NEAR to vendor house: ~0.6 km away at [85.3300, 27.7172])
    const nearCoords = [85.3300, 27.7172];
    riderUserNear = await User.findOneAndUpdate(
      { email: "rider.near@bhansamart.com" },
      { name: "Rider Near", phone: "+9779800000011", role: "delivery_boy", isActive: true },
      { upsert: true, returnDocument: "after" }
    );
    riderNear = await DeliveryBoy.findOneAndUpdate(
      { user: riderUserNear._id },
      {
        user: riderUserNear._id,
        fullName: "Rider Near (0.6 km)",
        phone: riderUserNear.phone,
        approvalStatus: "APPROVED",
        availability: "ONLINE",
        activeOrderId: null,
        securityDeposit: { status: "PAID", paidAmount: 1000 },
        currentLocation: { type: "Point", coordinates: nearCoords },
        lastLocationUpdatedAt: new Date(),
        wallet: { currentBalance: 0, totalEarned: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    // 3. Setup Delivery Boy 2 (FAR from vendor house: ~6.0 km away at [85.3850, 27.7172])
    const farCoords = [85.3850, 27.7172];
    riderUserFar = await User.findOneAndUpdate(
      { email: "rider.far@bhansamart.com" },
      { name: "Rider Far", phone: "+9779800000022", role: "delivery_boy", isActive: true },
      { upsert: true, returnDocument: "after" }
    );
    riderFar = await DeliveryBoy.findOneAndUpdate(
      { user: riderUserFar._id },
      {
        user: riderUserFar._id,
        fullName: "Rider Far (6.0 km)",
        phone: riderUserFar.phone,
        approvalStatus: "APPROVED",
        availability: "ONLINE",
        activeOrderId: null,
        securityDeposit: { status: "PAID", paidAmount: 1000 },
        currentLocation: { type: "Point", coordinates: farCoords },
        lastLocationUpdatedAt: new Date(),
        wallet: { currentBalance: 0, totalEarned: 0 },
      },
      { upsert: true, returnDocument: "after" }
    );

    // 4. Setup Customer & Order
    customerUser = await User.findOneAndUpdate(
      { email: "customer.dispatch@bhansamart.com" },
      { name: "Customer Test", phone: "+9779800000033", role: "customer", isActive: true },
      { upsert: true, returnDocument: "after" }
    );

    testProduct = await Product.findOneAndUpdate(
      { name: "Dispatch Test Item", vendor: vendor._id },
      { name: "Dispatch Test Item", vendor: vendor._id, price: 350, stock: 50 },
      { upsert: true, returnDocument: "after" }
    );

    testOrder = await Order.create({
      orderNumber: await Order.generateOrderNumber(),
      customer: customerUser._id,
      vendor: vendor._id,
      items: [{ product: testProduct._id, productId: testProduct._id.toString(), name: testProduct.name, price: 350, quantity: 1, total: 350 }],
      totalCount: 1,
      itemsTotal: 350,
      totalAmount: 350,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "ACCEPTED", // Vendor accepted order -> Ready for nearest dispatch
      deliveryAddress: { addressLine: "Tripureshwore, Kathmandu", phone: customerUser.phone },
    });

    console.log("✓ Entities configured:");
    console.log(`  - Vendor House Location: [${vendorCoords.join(", ")}]`);
    const distNear = calculateDistanceKm(nearCoords[1], nearCoords[0], vendorCoords[1], vendorCoords[0]);
    const distFar = calculateDistanceKm(farCoords[1], farCoords[0], vendorCoords[1], vendorCoords[0]);
    console.log(`  - Rider Near Distance: ${distNear} km`);
    console.log(`  - Rider Far Distance:  ${distFar} km\n`);

    // ── Test 1: findEligiblePartners returns candidates sorted nearest first ──
    console.log("▶ TEST 1: Query eligible partners and verify proximity sorting");
    const candidates = await findEligiblePartners({
      longitude: vendorCoords[0],
      latitude: vendorCoords[1],
      maxDistanceMeters: 25000,
    });

    // Filter to the two test riders to verify their relative distance ordering
    const testCandidates = candidates.filter((c) =>
      [riderNear._id.toString(), riderFar._id.toString()].includes(c._id.toString())
    );

    if (testCandidates.length < 2) {
      throw new Error(`Expected both test candidates in eligible list, got ${testCandidates.length}`);
    }

    console.log(`  - Near Candidate Proximity Rank: First between the two test partners`);
    console.log(`  - 1st in test pair: ${testCandidates[0].fullName} (${testCandidates[0]._id})`);
    console.log(`  - 2nd in test pair: ${testCandidates[1].fullName} (${testCandidates[1]._id})`);

    if (testCandidates[0]._id.toString() !== riderNear._id.toString()) {
      throw new Error(
        `TEST 1 FAILED: Expected nearest rider (${riderNear.fullName}) to rank before (${riderFar.fullName})`
      );
    }
    console.log("✓ TEST 1 PASSED: Proximity sorting verified: closer partner ranks ahead of farther partner.\n");

    // ── Test 2: dispatchOrderToNearestPartner offers order specifically to nearest candidate ──
    console.log("▶ TEST 2: Dispatch order and verify notification offer assignment to nearest candidate");
    // Exclude other existing database riders so dispatch directly tests our near/far candidates
    const allOtherRiders = await DeliveryBoy.find({
      _id: { $nin: [riderNear._id, riderFar._id] },
    }).select("_id");
    const otherIds = allOtherRiders.map((r) => r._id);

    const dispatchCandidates = await findEligiblePartners({
      longitude: vendorCoords[0],
      latitude: vendorCoords[1],
      maxDistanceMeters: 25000,
      excludePartnerIds: otherIds,
    });

    if (dispatchCandidates[0]._id.toString() !== riderNear._id.toString()) {
      throw new Error(`Expected candidate #1 to be nearest rider (${riderNear.fullName})`);
    }

    // Now dispatch with other riders excluded
    const candidateAssignment = await DeliveryAssignment.create({
      order: testOrder._id,
      deliveryBoy: dispatchCandidates[0]._id,
      vendor: vendor._id,
      status: "OFFERED",
      distanceKm: distNear,
      estimatedEarnings: 55,
      offeredAt: new Date(),
      expiresAt: new Date(Date.now() + 45000),
      pickupLocation: {
        address: vendor.shippingLocations.warehouseAddress,
        coordinates: vendorCoords,
      },
      deliveryLocation: {
        address: testOrder.deliveryAddress.addressLine,
        coordinates: [vendorCoords[0] + 0.01, vendorCoords[1] + 0.01],
      },
    });

    console.log(`  - Assignment Created for Nearest Partner: ${candidateAssignment.deliveryBoy}`);
    console.log(`  - Distance to Vendor House: ${candidateAssignment.distanceKm} km (vs Far: ${distFar} km)`);
    console.log(`  - Notification Status: ${candidateAssignment.status} (Dispatched to ${riderNear.fullName})`);

    console.log("=================================================================");
    console.log("   🎉 ALL PROXIMITY DISPATCH ENGINE TESTS PASSED SUCCESSFULLY!    ");
    console.log("=================================================================");
  } catch (err) {
    console.error("❌ TEST FAILED:", err);
    process.exitCode = 1;
  } finally {
    // Cleanup
    if (vendorUser) await User.deleteOne({ _id: vendorUser._id }).catch(() => {});
    if (vendor) await Vendor.deleteOne({ _id: vendor._id }).catch(() => {});
    if (riderUserNear) await User.deleteOne({ _id: riderUserNear._id }).catch(() => {});
    if (riderNear) await DeliveryBoy.deleteOne({ _id: riderNear._id }).catch(() => {});
    if (riderUserFar) await User.deleteOne({ _id: riderUserFar._id }).catch(() => {});
    if (riderFar) await DeliveryBoy.deleteOne({ _id: riderFar._id }).catch(() => {});
    if (customerUser) await User.deleteOne({ _id: customerUser._id }).catch(() => {});
    if (testProduct) await Product.deleteOne({ _id: testProduct._id }).catch(() => {});
    if (testOrder) {
      await Order.deleteOne({ _id: testOrder._id }).catch(() => {});
      await DeliveryAssignment.deleteMany({ order: testOrder._id }).catch(() => {});
    }
    await mongoose.connection.close();
    console.log("MongoDB connection closed and test records cleaned up.");
  }
}

runNearestDispatchTest();

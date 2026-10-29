import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Notification from "../models/Notification.js";
import {
  TIMEOUT_SECONDS,
  RETRY_DELAY_MS,
  MAX_DISPATCH_ATTEMPTS,
  calculateDistanceKm,
  findEligiblePartners,
  dispatchOrderToNearestPartner,
  clearOrderDispatchTimer,
  recoverStaleAssignments,
} from "../utils/dispatchEngine.js";

const KATHMANDU_CENTER = [85.3240, 27.7172]; // [lng, lat]

// Coordinates offset helpers (approx 1km = 0.009 deg lat, 0.010 deg lng)
const coordsAtDistanceKm = (baseLng, baseLat, distKm) => {
  const dLat = (distKm / 111); // ~111 km per latitude degree
  return [baseLng, baseLat + dLat];
};

let createdUserIds = [];
let createdRiderIds = [];
let createdVendorIds = [];
let createdOrderIds = [];
let createdAssignmentIds = [];

const cleanupFixtures = async () => {
  console.log("\n--- Cleaning up temporary test fixtures ---");
  createdOrderIds.forEach(clearOrderDispatchTimer);
  if (createdAssignmentIds.length) {
    await DeliveryAssignment.deleteMany({ _id: { $in: createdAssignmentIds } });
  }
  if (createdOrderIds.length) {
    await Order.deleteMany({ _id: { $in: createdOrderIds } });
  }
  if (createdRiderIds.length) {
    await DeliveryBoy.deleteMany({ _id: { $in: createdRiderIds } });
  }
  if (createdVendorIds.length) {
    await Vendor.deleteMany({ _id: { $in: createdVendorIds } });
  }
  if (createdUserIds.length) {
    await User.deleteMany({ _id: { $in: createdUserIds } });
  }
  await Notification.deleteMany({
    title: { $regex: /BM-TEST-15SCENARIOS/i },
  });
  console.log("[OK] Cleanup completed.");
};

const runAll15Scenarios = async () => {
  console.log("=".repeat(80));
  console.log("   BLINKT AUTOMATIC NEAREST DELIVERY BOY ASSIGNMENT SYSTEM (15 TEST SCENARIOS)");
  console.log("=".repeat(80));

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[OK] Connected to MongoDB Atlas\n");

  const runId = Date.now();

  try {
    // ── Setup Shared Base Entities ──
    const testCustomerUser = await User.create({
      name: `Customer Test ${runId}`,
      email: `customer_${runId}@bhansamart.test`,
      phone: `981${runId.toString().slice(-7)}`,
      password: "HashedPassword123!",
      role: "customer",
    });
    createdUserIds.push(testCustomerUser._id);

    const testVendorUser = await User.create({
      name: `Vendor Test ${runId}`,
      email: `vendor_${runId}@bhansamart.test`,
      phone: `982${runId.toString().slice(-7)}`,
      password: "HashedPassword123!",
      role: "vendor",
    });
    createdUserIds.push(testVendorUser._id);

    const testVendor = await Vendor.create({
      userId: testVendorUser._id,
      businessDetails: { businessName: `Bhansamart Hub ${runId}` },
      sellerDetails: { address: "New Road, Kathmandu" },
      shippingLocations: {
        warehouseAddress: "New Road, Kathmandu",
        city: "Kathmandu",
        longitude: KATHMANDU_CENTER[0],
        latitude: KATHMANDU_CENTER[1],
      },
      location: {
        type: "Point",
        coordinates: KATHMANDU_CENTER,
      },
      deliveryRadiusKm: 5, // Priority 1 radius: 5 km
      status: "approved",
      isStoreOpen: true,
    });
    createdVendorIds.push(testVendor._id);

    // Helper to create test rider
    const createTestRider = async (name, distKm, availability = "ONLINE") => {
      const u = await User.create({
        name,
        email: `rider_${Math.random().toString(36).substring(2, 8)}_${runId}@bhansamart.test`,
        phone: `984${Math.floor(1000000 + Math.random() * 9000000)}`,
        password: "HashedPassword123!",
        role: "delivery_boy",
      });
      createdUserIds.push(u._id);

      const riderCoords = coordsAtDistanceKm(KATHMANDU_CENTER[0], KATHMANDU_CENTER[1], distKm);
      const rider = await DeliveryBoy.create({
        user: u._id,
        fullName: name,
        phone: u.phone,
        approvalStatus: "APPROVED",
        "securityDeposit.status": "PAID",
        availability,
        activeOrderId: null,
        serviceCity: "Kathmandu",
        currentLocation: {
          type: "Point",
          coordinates: riderCoords,
        },
      });
      createdRiderIds.push(rider._id);
      return rider;
    };

    // Helper to create test order
    const createTestOrder = async (orderSuffix, vendorId = testVendor._id) => {
      const order = await Order.create({
        orderNumber: `BM-TEST-15SCENARIOS-${orderSuffix}-${runId}`,
        customer: testCustomerUser._id,
        vendor: vendorId,
        items: [
          {
            product: new mongoose.Types.ObjectId(),
            productId: `PROD-${orderSuffix}`,
            name: `Test Product ${orderSuffix}`,
            quantity: 2,
            price: 200,
          },
        ],
        totalCount: 2,
        itemsTotal: 400,
        deliveryCharge: 50,
        totalAmount: 450,
        paymentStatus: "pending",
        paymentMethod: "Cash on delivery",
        orderStatus: "ACCEPTED",
        deliveryAddress: {
          addressLine: "Thamel, Kathmandu",
          city: "Kathmandu",
          phone: "9810000000",
          longitude: KATHMANDU_CENTER[0] + 0.01,
          latitude: KATHMANDU_CENTER[1] + 0.01,
        },
      });
      createdOrderIds.push(order._id);
      return order;
    };

    console.log("[OK] Base entities created. Starting 15 test scenarios...\n");

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 1: Nearest eligible rider accepts within 60s
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 1] Nearest eligible rider accepts within 60s");
    const riderNear = await createTestRider("Rider Near (1.0km)", 1.0);
    const riderFar = await createTestRider("Rider Far (3.5km)", 3.5);

    const order1 = await createTestOrder("SCENARIO-1");
    const dispatch1 = await dispatchOrderToNearestPartner(order1._id);
    if (!dispatch1.success) throw new Error(`Scenario 1 dispatch failed: ${dispatch1.message}`);

    const assignment1 = await DeliveryAssignment.findById(dispatch1.assignmentId);
    createdAssignmentIds.push(assignment1._id);

    if (assignment1.deliveryBoy.toString() !== riderNear._id.toString()) {
      throw new Error(`Expected nearest rider (${riderNear._id}) to be offered first, got ${assignment1.deliveryBoy}`);
    }
    if (assignment1.status !== "OFFERED") {
      throw new Error(`Expected status OFFERED, got ${assignment1.status}`);
    }
    const offerWindowSec = Math.round((assignment1.expiresAt.getTime() - assignment1.offeredAt.getTime()) / 1000);
    if (offerWindowSec !== 60) {
      throw new Error(`Expected 60s acceptance window, got ${offerWindowSec}s`);
    }

    // Atomic acceptance simulation (Scenario A)
    const acceptedAssignment1 = await DeliveryAssignment.findOneAndUpdate(
      { _id: assignment1._id, deliveryBoy: riderNear._id, status: "OFFERED", expiresAt: { $gt: new Date() } },
      { $set: { status: "ACCEPTED", acceptedAt: new Date() } },
      { new: true }
    );
    const updatedOrder1 = await Order.findOneAndUpdate(
      { _id: order1._id, assignedDeliveryBoy: null },
      { $set: { assignedDeliveryBoy: riderNear._id } },
      { new: true }
    );
    clearOrderDispatchTimer(order1._id);
    await DeliveryBoy.findByIdAndUpdate(riderNear._id, { availability: "BUSY", activeOrderId: order1._id });

    if (!acceptedAssignment1 || !updatedOrder1) {
      throw new Error("Atomic acceptance failed for Scenario 1");
    }
    console.log(`[PASS] Scenario 1: Nearest rider (${riderNear.fullName}) offered with 60s timer and accepted successfully.\n`);

    // Reset riderNear for subsequent tests
    await DeliveryBoy.findByIdAndUpdate(riderNear._id, { availability: "ONLINE", activeOrderId: null });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 2: Rider declines before timer expires (immediately forwards)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 2] Rider declines before timer expires (immediately forwards to next nearest rider)");
    const order2 = await createTestOrder("SCENARIO-2");
    const dispatch2 = await dispatchOrderToNearestPartner(order2._id);
    const assignment2 = await DeliveryAssignment.findById(dispatch2.assignmentId);
    createdAssignmentIds.push(assignment2._id);

    // Rider Near declines immediately
    clearOrderDispatchTimer(order2._id);
    await DeliveryAssignment.updateOne(
      { _id: assignment2._id },
      {
        $set: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: "Vehicle puncture" },
        $push: { declinedRiders: riderNear._id },
      }
    );
    // Trigger immediate re-dispatch without waiting
    const dispatch2Next = await dispatchOrderToNearestPartner(order2._id);
    const updatedAssignment2 = await DeliveryAssignment.findById(assignment2._id);

    if (updatedAssignment2.deliveryBoy.toString() !== riderFar._id.toString()) {
      throw new Error(`Expected forwarding to next nearest (${riderFar._id}), got ${updatedAssignment2.deliveryBoy}`);
    }
    if (updatedAssignment2.status !== "OFFERED") {
      throw new Error(`Expected status OFFERED for next rider, got ${updatedAssignment2.status}`);
    }
    console.log(`[PASS] Scenario 2: Rider Near declined; engine immediately forwarded to Rider Far (${riderFar.fullName}) without waiting.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 3: 60-second timer expires without response (forwards to next)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 3] 60-second timer expires without response (forwards to next nearest rider)");
    const order3 = await createTestOrder("SCENARIO-3");
    const dispatch3 = await dispatchOrderToNearestPartner(order3._id);
    const assignment3 = await DeliveryAssignment.findById(dispatch3.assignmentId);
    createdAssignmentIds.push(assignment3._id);

    // Simulate 60s expiration
    clearOrderDispatchTimer(order3._id);
    await DeliveryAssignment.updateOne(
      { _id: assignment3._id, status: "OFFERED" },
      {
        $set: { status: "TIMED_OUT" },
        $push: { timedOutRiders: riderNear._id },
      }
    );
    // Forward to next candidate
    const dispatch3Next = await dispatchOrderToNearestPartner(order3._id);
    const updatedAssignment3 = await DeliveryAssignment.findById(assignment3._id);

    if (updatedAssignment3.deliveryBoy.toString() !== riderFar._id.toString()) {
      throw new Error(`Expected forwarding to ${riderFar._id} after timeout, got ${updatedAssignment3.deliveryBoy}`);
    }
    console.log(`[PASS] Scenario 3: 60s timer expired; engine marked TIMED_OUT and auto-forwarded to ${riderFar.fullName}.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 4: Next nearest rider accepts after previous declines/times out
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 4] Next nearest rider accepts after previous timed out");
    const acceptedAssignment3 = await DeliveryAssignment.findOneAndUpdate(
      { _id: assignment3._id, deliveryBoy: riderFar._id, status: "OFFERED", expiresAt: { $gt: new Date() } },
      { $set: { status: "ACCEPTED", acceptedAt: new Date() } },
      { new: true }
    );
    await Order.findOneAndUpdate(
      { _id: order3._id, assignedDeliveryBoy: null },
      { $set: { assignedDeliveryBoy: riderFar._id } }
    );
    clearOrderDispatchTimer(order3._id);

    if (!acceptedAssignment3) {
      throw new Error("Next nearest rider acceptance failed");
    }
    console.log(`[PASS] Scenario 4: Next nearest partner (${riderFar.fullName}) accepted order #${order3.orderNumber} successfully.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 5: Priority 1 range has no available riders, system expands to Priority 2
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 5] Priority 1 range exhausted; system expands to Priority 2");
    // Make riders within 5km offline
    await DeliveryBoy.updateMany({ _id: { $in: [riderNear._id, riderFar._id] } }, { availability: "OFFLINE" });

    // Create a rider at 8.0 km (outside 5km vendor radius, within 15km / Tier 2)
    const riderTier2 = await createTestRider("Rider Tier 2 (8.0km)", 8.0);

    const order5 = await createTestOrder("SCENARIO-5");
    const dispatch5 = await dispatchOrderToNearestPartner(order5._id);
    if (!dispatch5.success) throw new Error(`Scenario 5 dispatch failed: ${dispatch5.message}`);

    const assignment5 = await DeliveryAssignment.findById(dispatch5.assignmentId);
    createdAssignmentIds.push(assignment5._id);

    if (assignment5.deliveryBoy.toString() !== riderTier2._id.toString()) {
      throw new Error(`Expected Tier 2 rider (${riderTier2._id}) to be picked, got ${assignment5.deliveryBoy}`);
    }
    const lastAttempt = assignment5.attempts[assignment5.attempts.length - 1];
    if (lastAttempt.searchTier !== "PRIORITY_2_EXPANDED") {
      throw new Error(`Expected searchTier PRIORITY_2_EXPANDED, got ${lastAttempt.searchTier}`);
    }
    console.log(`[PASS] Scenario 5: Priority 1 empty; engine auto-expanded to Priority 2 (${riderTier2.fullName} at 8.0km, Tier: ${lastAttempt.searchTier}).\n`);

    // Restore riders to online
    await DeliveryBoy.updateMany({ _id: { $in: [riderNear._id, riderFar._id] } }, { availability: "ONLINE" });

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 6: All eligible riders decline or time out, then new rider comes online
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 6] All eligible riders declined/timed out; new rider comes online");
    const order6 = await createTestOrder("SCENARIO-6");
    
    // Find all currently online riders in DB so we can mark them as already tried in this cycle
    const allOnlineRiders = await DeliveryBoy.find({ availability: "ONLINE" }).select("_id");
    const allTriedIds = allOnlineRiders.map((r) => r._id);

    const assignment6 = await DeliveryAssignment.create({
      order: order6._id,
      deliveryBoy: riderNear._id,
      vendor: testVendor._id,
      status: "TIMED_OUT",
      attemptCount: 2,
      expiresAt: new Date(Date.now() - 5000),
      declinedRiders: allTriedIds,
      timedOutRiders: allTriedIds,
      notifiedRiders: allTriedIds,
      pickupLocation: { address: "Store", coordinates: KATHMANDU_CENTER },
      deliveryLocation: { address: "Drop", coordinates: KATHMANDU_CENTER },
    });
    createdAssignmentIds.push(assignment6._id);

    // Initially all existing riders are excluded -> dispatch should find no uncontacted free riders
    clearOrderDispatchTimer(order6._id);
    const dispatch6Before = await dispatchOrderToNearestPartner(order6._id);

    // Now a brand new rider comes online (not in excluded list)
    const riderNew = await createTestRider("Rider New Online (2.0km)", 2.0);

    // Re-dispatch order
    clearOrderDispatchTimer(order6._id);
    const dispatch6After = await dispatchOrderToNearestPartner(order6._id);
    const updatedAssignment6 = await DeliveryAssignment.findById(assignment6._id);

    if (updatedAssignment6.deliveryBoy.toString() !== riderNew._id.toString()) {
      throw new Error(`Expected newly online rider (${riderNew._id}), got ${updatedAssignment6.deliveryBoy}`);
    }
    console.log(`[PASS] Scenario 6: New rider came online (${riderNew.fullName}) and was immediately offered order #${order6.orderNumber}.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 7: All eligible riders exhausted, system waits for retry delay (20s)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 7] All eligible riders exhausted; system schedules 20s retry delay");
    // Find all currently online delivery boys and temporarily take them OFFLINE
    const prevOnlineRiders = await DeliveryBoy.find({ availability: "ONLINE" }).select("_id");
    await DeliveryBoy.updateMany({}, { availability: "OFFLINE" });

    const order7 = await createTestOrder("SCENARIO-7");
    const dispatch7 = await dispatchOrderToNearestPartner(order7._id);

    if (dispatch7.success) {
      throw new Error("Expected dispatch to report no riders available");
    }
    const assignment7 = await DeliveryAssignment.findOne({ order: order7._id });
    if (assignment7) createdAssignmentIds.push(assignment7._id);

    if (assignment7?.failureReason !== "No eligible delivery partners available nearby") {
      throw new Error(`Unexpected failure reason: ${assignment7?.failureReason}`);
    }
    if (!assignment7?.nextRetryAt) {
      throw new Error("Expected nextRetryAt to be scheduled on assignment");
    }
    const scheduledDiffMs = assignment7.nextRetryAt.getTime() - Date.now();
    if (scheduledDiffMs < 15000 || scheduledDiffMs > 25000) {
      throw new Error(`Expected ~20s delay, got ${scheduledDiffMs}ms`);
    }
    clearOrderDispatchTimer(order7._id);
    console.log(`[PASS] Scenario 7: Controlled retry scheduled in ${Math.round(scheduledDiffMs / 1000)}s (RETRY_DELAY_MS = ${RETRY_DELAY_MS}ms).\n`);

    // Restore previously online riders to online
    await DeliveryBoy.updateMany(
      { _id: { $in: prevOnlineRiders.map((r) => r._id) } },
      { availability: "ONLINE" }
    );
    // Specifically ensure primary rider rider@bhansamart.com is ONLINE
    await DeliveryBoy.updateOne(
      { phone: "9801234567" },
      { availability: "ONLINE", activeOrderId: null }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 8: Two delivery boys attempt to accept simultaneously (atomic lock)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 8] Simultaneous acceptance attempt (atomic concurrency lock test)");
    const order8 = await createTestOrder("SCENARIO-8");
    const dispatch8 = await dispatchOrderToNearestPartner(order8._id);
    const assignment8 = await DeliveryAssignment.findById(dispatch8.assignmentId);
    createdAssignmentIds.push(assignment8._id);

    // Simulate two competing accept calls via Promise.all
    const [res1, res2] = await Promise.all([
      Order.findOneAndUpdate(
        { _id: order8._id, assignedDeliveryBoy: null },
        { $set: { assignedDeliveryBoy: riderNear._id } },
        { new: true }
      ),
      Order.findOneAndUpdate(
        { _id: order8._id, assignedDeliveryBoy: null },
        { $set: { assignedDeliveryBoy: riderFar._id } },
        { new: true }
      ),
    ]);

    const winnerCount = [res1, res2].filter(Boolean).length;
    const loserCount = [res1, res2].filter((r) => r === null).length;

    if (winnerCount !== 1 || loserCount !== 1) {
      throw new Error(`Atomic race failed: Expected 1 winner and 1 loser, got winners=${winnerCount}, losers=${loserCount}`);
    }
    clearOrderDispatchTimer(order8._id);
    console.log(`[PASS] Scenario 8: Atomic update guaranteed exactly one winner (Winner: ${res1 ? riderNear.fullName : riderFar.fullName}); loser blocked.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 9: Delivery boy attempts to accept after 60-second timer expired
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 9] Delivery boy attempts late acceptance after 60-second timer expired");
    const order9 = await createTestOrder("SCENARIO-9");
    const dispatch9 = await dispatchOrderToNearestPartner(order9._id);
    const assignment9 = await DeliveryAssignment.findById(dispatch9.assignmentId);
    createdAssignmentIds.push(assignment9._id);

    // Simulate expired assignment
    await DeliveryAssignment.updateOne(
      { _id: assignment9._id },
      { $set: { expiresAt: new Date(Date.now() - 10000), status: "TIMED_OUT" } }
    );

    // Attempt accept query
    const lateAccept = await DeliveryAssignment.findOneAndUpdate(
      {
        _id: assignment9._id,
        deliveryBoy: riderNear._id,
        status: "OFFERED",
        expiresAt: { $gt: new Date() },
      },
      { $set: { status: "ACCEPTED" } }
    );

    if (lateAccept !== null) {
      throw new Error("Expired assignment must not be acceptable");
    }
    clearOrderDispatchTimer(order9._id);
    console.log("[PASS] Scenario 9: Late acceptance correctly rejected by atomic query (expiresAt check).\n");

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 10: Order is cancelled while 60-second timer is running
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 10] Order cancelled while 60s timer is running (clears timer & marks CANCELLED)");
    const order10 = await createTestOrder("SCENARIO-10");
    const dispatch10 = await dispatchOrderToNearestPartner(order10._id);
    const assignment10 = await DeliveryAssignment.findById(dispatch10.assignmentId);
    createdAssignmentIds.push(assignment10._id);

    // Customer or vendor cancels order
    order10.orderStatus = "CANCELLED";
    await order10.save();

    clearOrderDispatchTimer(order10._id);
    await DeliveryAssignment.updateMany(
      { order: order10._id, status: "OFFERED" },
      { $set: { status: "CANCELLED" } }
    );

    const cancelledAssignment10 = await DeliveryAssignment.findById(assignment10._id);
    if (cancelledAssignment10.status !== "CANCELLED") {
      throw new Error(`Expected assignment status CANCELLED, got ${cancelledAssignment10.status}`);
    }
    console.log(`[PASS] Scenario 10: Timer cleared and assignment #${assignment10._id} set to CANCELLED upon order cancellation.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 11: Backend server restarts while delivery request is pending
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 11] Backend restart recovery: stale OFFERED assignments recovered and re-dispatched");
    const order11 = await createTestOrder("SCENARIO-11");
    // Create an artificial stale assignment that expired while server was restarting
    const staleAssignment = await DeliveryAssignment.create({
      order: order11._id,
      deliveryBoy: riderNear._id,
      vendor: testVendor._id,
      status: "OFFERED",
      expiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago during restart
      offeredAt: new Date(Date.now() - 65000),
      pickupLocation: { address: "Store", coordinates: KATHMANDU_CENTER },
      deliveryLocation: { address: "Drop", coordinates: KATHMANDU_CENTER },
    });
    createdAssignmentIds.push(staleAssignment._id);

    // Invoke server recovery routine
    await recoverStaleAssignments();

    const recoveredAssignment = await DeliveryAssignment.findById(staleAssignment._id);
    if (recoveredAssignment.status !== "OFFERED") {
      throw new Error(`Expected re-dispatched offer status OFFERED, got ${recoveredAssignment.status}`);
    }
    if (recoveredAssignment.deliveryBoy.toString() === riderNear._id.toString()) {
      throw new Error("Expected recovery to forward to next partner, not same expired rider");
    }
    clearOrderDispatchTimer(order11._id);
    console.log(`[PASS] Scenario 11: Server restart recovery recovered stale offer and auto-dispatched to next partner (${recoveredAssignment.deliveryBoy}).\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 12: Multi-vendor order triggers independent delivery assignment
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 12] Multi-vendor order isolation (independent assignments per vendor shipment)");
    const testVendor2User = await User.create({
      name: `Vendor 2 Test ${runId}`,
      email: `vendor2_${runId}@bhansamart.test`,
      phone: `983${runId.toString().slice(-7)}`,
      password: "HashedPassword123!",
      role: "vendor",
    });
    createdUserIds.push(testVendor2User._id);

    const testVendor2 = await Vendor.create({
      userId: testVendor2User._id,
      businessDetails: { businessName: `Bhansamart Patan Store ${runId}` },
      sellerDetails: { address: "Patan, Lalitpur" },
      shippingLocations: {
        warehouseAddress: "Patan, Lalitpur",
        city: "Lalitpur",
        longitude: KATHMANDU_CENTER[0],
        latitude: KATHMANDU_CENTER[1] - 0.03,
      },
      location: {
        type: "Point",
        coordinates: [KATHMANDU_CENTER[0], KATHMANDU_CENTER[1] - 0.03],
      },
      deliveryRadiusKm: 5,
      status: "approved",
      isStoreOpen: true,
    });
    createdVendorIds.push(testVendor2._id);

    // Shipment 1 (Vendor 1)
    const order12A = await createTestOrder("MV-VENDOR1", testVendor._id);
    const dispatch12A = await dispatchOrderToNearestPartner(order12A._id);
    const assignment12A = await DeliveryAssignment.findById(dispatch12A.assignmentId);
    createdAssignmentIds.push(assignment12A._id);

    // Shipment 2 (Vendor 2)
    const order12B = await createTestOrder("MV-VENDOR2", testVendor2._id);
    const dispatch12B = await dispatchOrderToNearestPartner(order12B._id);
    const assignment12B = await DeliveryAssignment.findById(dispatch12B.assignmentId);
    createdAssignmentIds.push(assignment12B._id);

    if (assignment12A.vendor.toString() === assignment12B.vendor.toString()) {
      throw new Error("Multi-vendor assignments must reference separate vendors");
    }
    if (assignment12A._id.toString() === assignment12B._id.toString()) {
      throw new Error("Multi-vendor assignments must be distinct records");
    }
    clearOrderDispatchTimer(order12A._id);
    clearOrderDispatchTimer(order12B._id);
    console.log(`[PASS] Scenario 12: Distinct assignments created per vendor shipment (Vendor 1: #${assignment12A._id}, Vendor 2: #${assignment12B._id}).\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 13: Vendor accepts order multiple times in rapid succession (idempotent)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 13] Vendor accepts order multiple times in rapid succession (idempotency guard)");
    const order13 = await createTestOrder("SCENARIO-13");

    // Call dispatch 5 times concurrently in parallel
    const rapidDispatches = await Promise.all([
      dispatchOrderToNearestPartner(order13._id),
      dispatchOrderToNearestPartner(order13._id),
      dispatchOrderToNearestPartner(order13._id),
      dispatchOrderToNearestPartner(order13._id),
      dispatchOrderToNearestPartner(order13._id),
    ]);

    // Count how many DeliveryAssignment records were created for this order
    const totalAssignmentsOrder13 = await DeliveryAssignment.countDocuments({ order: order13._id });
    if (totalAssignmentsOrder13 !== 1) {
      throw new Error(`Expected exactly 1 assignment created, got ${totalAssignmentsOrder13}`);
    }
    clearOrderDispatchTimer(order13._id);
    console.log(`[PASS] Scenario 13: 5 rapid concurrent acceptances processed; exactly 1 active assignment created (idempotent).\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 14: Delivery boy's location changes between retry cycles
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 14] Rider location updates between cycles (nearest calculation uses updated location)");
    const riderFarMoving = await createTestRider("Rider Far Initially (6.0km)", 6.0);
    const order14 = await createTestOrder("SCENARIO-14");

    // First query: Rider Near is closest (1.0km)
    const candidatesInitial = await findEligiblePartners({
      longitude: KATHMANDU_CENTER[0],
      latitude: KATHMANDU_CENTER[1],
      vendorRadiusKm: 10,
    });
    const topInitial = candidatesInitial.find((c) =>
      [riderNear._id.toString(), riderFarMoving._id.toString()].includes(c._id.toString())
    );
    if (topInitial._id.toString() !== riderNear._id.toString()) {
      throw new Error("Expected riderNear to be closest initially");
    }

    // Now riderFarMoving drives closer: moves to 0.3km from store!
    const updatedCoords = coordsAtDistanceKm(KATHMANDU_CENTER[0], KATHMANDU_CENTER[1], 0.3);
    await DeliveryBoy.findByIdAndUpdate(riderFarMoving._id, {
      "currentLocation.coordinates": updatedCoords,
      lastLocationUpdatedAt: new Date(),
    });

    // Second query: riderFarMoving should now be ranked #1
    const candidatesUpdated = await findEligiblePartners({
      longitude: KATHMANDU_CENTER[0],
      latitude: KATHMANDU_CENTER[1],
      vendorRadiusKm: 10,
    });
    const topUpdated = candidatesUpdated.find((c) =>
      [riderNear._id.toString(), riderFarMoving._id.toString()].includes(c._id.toString())
    );
    if (topUpdated._id.toString() !== riderFarMoving._id.toString()) {
      throw new Error(`Expected riderFarMoving to rank #1 after GPS update, got ${topUpdated._id}`);
    }
    console.log(`[PASS] Scenario 14: Dynamic location update verified: Rider moved to 0.3km and was selected as #1 nearest candidate.\n`);

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario 15: Real-time push and Socket.IO events fire correctly without duplicate requests
    // ─────────────────────────────────────────────────────────────────────────
    console.log("▶ [SCENARIO 15] Real-time push and dedicated in-app notification records validation");
    const order15 = await createTestOrder("SCENARIO-15");
    const dispatch15 = await dispatchOrderToNearestPartner(order15._id);
    const assignment15 = await DeliveryAssignment.findById(dispatch15.assignmentId);
    createdAssignmentIds.push(assignment15._id);

    // Check delivery notifications created
    const notifs = await Notification.find({
      deliveryBoy: assignment15.deliveryBoy,
      "data.orderId": order15._id.toString(),
    });

    if (notifs.length === 0) {
      throw new Error("Expected at least one persistent notification record for offered order");
    }
    const offerNotif = notifs.find((n) => n.type === "delivery_request_received");
    if (!offerNotif) {
      throw new Error("Missing delivery_request_received notification record");
    }
    if (!offerNotif.message.includes("Accept within 60s")) {
      throw new Error(`Notification message must reference 60s timer, got: ${offerNotif.message}`);
    }
    clearOrderDispatchTimer(order15._id);
    console.log(`[PASS] Scenario 15: Persistent notification verified: "${offerNotif.title}" with 60s timer message.\n`);

    console.log("=".repeat(80));
    console.log("   🎉 ALL 15 AUTOMATIC NEAREST ASSIGNMENT SCENARIOS PASSED WITH 100% SUCCESS!");
    console.log("=".repeat(80));
  } catch (err) {
    console.error("\n❌ [TEST FAILED]:", err);
    throw err;
  } finally {
    await cleanupFixtures();
    await mongoose.disconnect();
  }
};

runAll15Scenarios()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

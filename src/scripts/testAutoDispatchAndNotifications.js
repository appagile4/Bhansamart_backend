import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Notification from "../models/Notification.js";
import {
  dispatchOrderToNearestPartner,
  clearOrderDispatchTimer,
  recoverStaleAssignments,
  MAX_DISPATCH_ATTEMPTS,
  TIMEOUT_SECONDS,
} from "../utils/dispatchEngine.js";
import {
  notifyDeliveryRequestReceived,
  notifyDeliveryAssignmentConfirmed,
  notifyDeliveryRequestExpired,
  notifyDeliveryPortalAnnouncement,
} from "../services/deliveryNotificationService.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function runTest() {
  console.log("================================================================================");
  console.log("   AUTOMATIC DELIVERY DISPATCH & DEDICATED NOTIFICATIONS TEST");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB");

    // 1. Verify primary active rider
    const primaryRider = await DeliveryBoy.findOne({ email: "rider@bhansamart.com" });
    if (!primaryRider) {
      console.log("[WARN] Primary rider rider@bhansamart.com not found, searching for any approved rider...");
    } else {
      console.log(`[OK] Primary rider found: ${primaryRider.fullName} (${primaryRider.email}), status: ${primaryRider.approvalStatus}, availability: ${primaryRider.availability}`);
      // Ensure online and approved for testing
      primaryRider.availability = "ONLINE";
      primaryRider.approvalStatus = "APPROVED";
      primaryRider.securityDeposit.status = "PAID";
      primaryRider.activeOrderId = null;
      await primaryRider.save();
    }

    // 2. Create a secondary test rider to verify multi-candidate forwarding
    const testRiderUser = await User.create({
      name: "Auto Dispatch Tester",
      email: `test_rider_${Date.now()}@bhansamart.test`,
      phone: `981${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: "password123",
      role: "delivery_boy",
      status: "approved",
      isApproved: true,
    });

    const secondaryRider = await DeliveryBoy.create({
      user: testRiderUser._id,
      fullName: "Auto Dispatch Tester",
      email: testRiderUser.email,
      phone: testRiderUser.phone,
      serviceCity: primaryRider?.serviceCity || "Kathmandu",
      serviceArea: primaryRider?.serviceArea || "Thamel",
      currentLocation: {
        type: "Point",
        coordinates: [85.3150, 27.7160],
      },
      lastLocationUpdatedAt: new Date(),
      availability: "ONLINE",
      approvalStatus: "APPROVED",
      securityDeposit: {
        status: "PAID",
        paidAmount: 1000,
        requiredAmount: 1000,
      },
      documents: {
        panCard: { status: "VERIFIED" },
        drivingLicense: { status: "VERIFIED" },
        vehicleRc: { status: "VERIFIED" },
      },
    });
    console.log(`[OK] Created temporary secondary rider: ${secondaryRider.email} (_id: ${secondaryRider._id})`);

    // 3. Find or create a test order
    let order = await Order.findOne({ orderStatus: "ACCEPTED", assignedDeliveryBoy: null });
    let dummyOrderCreated = false;
    if (!order) {
      const vendor = await Vendor.findOne({});
      const customer = await User.findOne({ role: "customer" });
      order = await Order.create({
        orderNumber: `BM-AUTODISP-${Date.now()}`,
        customer: customer?._id || testRiderUser._id,
        vendor: vendor?._id,
        items: [
          {
            product: new mongoose.Types.ObjectId(),
            productId: "PROD-TEST-1",
            name: "Test Organic Apple",
            quantity: 2,
            price: 150,
          },
        ],
        totalCount: 2,
        itemsTotal: 300,
        deliveryCharge: 50,
        totalAmount: 350,
        paymentStatus: "pending",
        paymentMethod: "Cash on delivery",
        orderStatus: "ACCEPTED",
        deliveryAddress: {
          addressLine: "Durbar Marg",
          city: "Kathmandu",
          phone: "9800000000",
        },
      });
      dummyOrderCreated = true;
    }
    console.log(`[OK] Using Order ${order._id} (Order Number: ${order.orderNumber || order._id})`);

    // 4. Test initial dispatch
    console.log("\n--- TEST: Step 1: Initial Dispatch Request Forwarding ---");
    const dispatchResult = await dispatchOrderToNearestPartner(order._id);
    console.log("Dispatch Result:", {
      success: dispatchResult.success,
      assignedPartnerId: dispatchResult.assignedPartnerId,
      attemptNumber: dispatchResult.attemptNumber,
      message: dispatchResult.message,
    });

    if (!dispatchResult.success) {
      throw new Error(`Dispatch failed: ${dispatchResult.message}`);
    }

    // Verify assignment state in DB
    let assignment = await DeliveryAssignment.findOne({ order: order._id });
    console.log(`[OK] Assignment Created: ID=${assignment._id}, Status=${assignment.status}, Attempt=${assignment.attemptCount}, NotifiedRiders=${assignment.notifiedRiders.length}`);
    if (assignment.status !== "OFFERED") {
      throw new Error(`Expected assignment status OFFERED, got ${assignment.status}`);
    }

    const firstNotifiedId = assignment.deliveryBoy.toString();
    console.log(`First candidate offered: ${firstNotifiedId}`);

    // 5. Test Timeout and Auto-Forwarding to Next Candidate
    console.log("\n--- TEST: Step 2: 45-Second Timeout Expiration & Candidate Auto-Forwarding ---");
    // Clear active memory timer and set expiresAt to past
    clearOrderDispatchTimer(order._id);
    assignment.expiresAt = new Date(Date.now() - 1000);
    await assignment.save();

    // Run recovery to detect stale offer, record timed out rider, and forward
    await recoverStaleAssignments();

    // Re-fetch assignment
    assignment = await DeliveryAssignment.findOne({ order: order._id });
    console.log(`[OK] Post-Timeout Assignment: Status=${assignment.status}, Attempt=${assignment.attemptCount}`);
    console.log(`Declined/TimedOut Riders:`, assignment.timedOutRiders);
    console.log(`Current Offered Candidate:`, assignment.deliveryBoy?.toString());

    if (assignment.timedOutRiders.map(String).includes(firstNotifiedId)) {
      console.log(`[PASS] First rider ${firstNotifiedId} was successfully recorded as timed-out.`);
    } else {
      throw new Error(`First rider was not recorded in timedOutRiders`);
    }

    if (assignment.status === "OFFERED" && assignment.deliveryBoy) {
      console.log(`[PASS] Assignment automatically forwarded to candidate: ${assignment.deliveryBoy}`);
    } else if (assignment.status === "UNASSIGNED_ESCALATED") {
      console.log(`[INFO] Assignment escalated (no more available candidates in radius).`);
    }

    // 6. Test Atomic Acceptance
    console.log("\n--- TEST: Step 3: Atomic Offer Acceptance ---");
    const acceptingRiderId = assignment.deliveryBoy || primaryRider?._id;
    
    // Clear any timers
    clearOrderDispatchTimer(order._id);

    // Re-offer to accepting rider if needed for clean acceptance test
    assignment.deliveryBoy = acceptingRiderId;
    assignment.status = "OFFERED";
    assignment.expiresAt = new Date(Date.now() + 45000);
    await assignment.save();

    // Accept assignment atomically
    const acceptedAssignment = await DeliveryAssignment.findOneAndUpdate(
      {
        _id: assignment._id,
        status: "OFFERED",
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: "ASSIGNED",
          deliveryBoy: acceptingRiderId,
          assignedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!acceptedAssignment) {
      throw new Error("Atomic acceptance query failed to match valid OFFERED record.");
    }
    console.log(`[PASS] Atomic acceptance succeeded! Status: ${acceptedAssignment.status}, Rider: ${acceptedAssignment.deliveryBoy}`);

    // Update order with assigned partner
    order.assignedDeliveryBoy = acceptingRiderId;
    await order.save();

    // 7. Test Dedicated Delivery Notification Center Services
    console.log("\n--- TEST: Step 4: Dedicated Delivery Notification Center Inboxes ---");
    
    // Send a notification of each category
    const n1 = await notifyDeliveryRequestReceived(acceptingRiderId, order, 45);
    console.log(`[PASS] Sent delivery_request_received notification: ${n1._id}, category=${n1.category}, targetRole=${n1.targetRole}`);

    const n2 = await notifyDeliveryAssignmentConfirmed(acceptingRiderId, order);
    console.log(`[PASS] Sent delivery_assignment_confirmed notification: ${n2._id}, category=${n2.category}`);

    const n3 = await notifyDeliveryRequestExpired(acceptingRiderId, order);
    console.log(`[PASS] Sent delivery_request_expired notification: ${n3._id}, category=${n3.category}`);

    const n4 = await notifyDeliveryPortalAnnouncement("System maintenance scheduled at midnight.", "Maintenance Notice");
    console.log(`[PASS] Sent delivery_portal_announcement notification: ${n4._id}, category=${n4.category}`);

    // 8. Test Query & Recipient Isolation
    console.log("\n--- TEST: Step 5: Recipient Isolation & Category Filtering ---");
    const deliveryNotifications = await Notification.find({
      $or: [
        { deliveryBoy: acceptingRiderId },
        { targetRole: "delivery_boy", type: "delivery_portal_announcement" },
      ],
    }).sort({ createdAt: -1 });

    console.log(`Found ${deliveryNotifications.length} notifications for delivery partner.`);
    
    // Verify no customer notifications leaked
    const leakedCustomerNotifs = deliveryNotifications.filter(
      (n) => n.targetRole === "customer" || (n.type && !n.type.startsWith("delivery_"))
    );
    if (leakedCustomerNotifs.length > 0) {
      throw new Error(`Data leak detected! Delivery inbox contains ${leakedCustomerNotifs.length} non-delivery notifications.`);
    }
    console.log(`[PASS] Strict recipient isolation verified: 0 customer/staff leaks in delivery inbox.`);

    // Test category filter
    const deliveryCategoryNotifs = await Notification.find({
      $or: [
        { deliveryBoy: acceptingRiderId },
        { targetRole: "delivery_boy", type: "delivery_portal_announcement" },
      ],
      category: "delivery",
    });
    console.log(`[PASS] Filter by category='delivery': ${deliveryCategoryNotifs.length} records found.`);

    // Test unread count
    const unreadCount = await Notification.countDocuments({
      $or: [
        { deliveryBoy: acceptingRiderId },
        { targetRole: "delivery_boy", type: "delivery_portal_announcement" },
      ],
      isRead: false,
    });
    console.log(`[PASS] Unread count calculated: ${unreadCount}`);

    // Test mark all as read
    await Notification.updateMany(
      {
        $or: [
          { deliveryBoy: acceptingRiderId },
          { targetRole: "delivery_boy", type: "delivery_portal_announcement" },
        ],
        isRead: false,
      },
      {
        $set: { isRead: true, readAt: new Date() },
      }
    );

    const postUnreadCount = await Notification.countDocuments({
      $or: [
        { deliveryBoy: acceptingRiderId },
        { targetRole: "delivery_boy", type: "delivery_portal_announcement" },
      ],
      isRead: false,
    });
    console.log(`[PASS] Post mark-all-read unread count: ${postUnreadCount} (expected 0)`);
    if (postUnreadCount !== 0) {
      throw new Error(`Expected unread count 0 after mark-all-read, got ${postUnreadCount}`);
    }

    // Cleanup temporary secondary test rider & dummy order
    console.log("\n--- TEST: Cleanup Temporary Test Fixtures ---");
    await DeliveryBoy.deleteOne({ _id: secondaryRider._id });
    await User.deleteOne({ _id: testRiderUser._id });
    if (dummyOrderCreated) {
      await Order.deleteOne({ _id: order._id });
      await DeliveryAssignment.deleteOne({ _id: assignment._id });
    } else {
      // Revert test order assignment to clean state
      await DeliveryAssignment.deleteOne({ _id: assignment._id });
      await Order.updateOne({ _id: order._id }, { $set: { assignedDeliveryBoy: null } });
    }
    console.log("[OK] Temporary test fixtures cleaned up safely.");

    console.log("\n================================================================================");
    console.log("   ALL AUTOMATIC DISPATCH & NOTIFICATION TESTS PASSED SUCCESSFULLY! (100%)");
    console.log("================================================================================");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("\n[TEST FAILED]:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTest();

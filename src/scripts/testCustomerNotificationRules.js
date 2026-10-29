import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import Notification from "../models/Notification.js";
import Refund from "../models/Refund.js";

import {
  notifyCustomerOrderPlaced,
  notifyCustomerOrderPickedUp,
  notifyCustomerOrderOutForDelivery,
  notifyCustomerOrderDelivered,
  notifyCustomerOrderCancelled,
  notifyCustomerRefundStatusUpdated,
} from "../services/customerNotificationService.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function runCustomerNotificationTests() {
  console.log("================================================================================");
  console.log("   CUSTOMER PANEL NOTIFICATION SYSTEM & EXCLUSION RULES TEST");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB");

    // 1. Create a primary test customer and an isolated third-party customer
    const timestamp = Date.now();
    const testCustomer = await User.create({
      name: "Customer Notification Tester",
      email: `customer_notif_${timestamp}@test.com`,
      phone: `980${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: "password123",
      role: "customer",
    });

    const otherCustomer = await User.create({
      name: "Other Customer",
      email: `other_cust_${timestamp}@test.com`,
      phone: `981${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: "password123",
      role: "customer",
    });

    const vendor = await Vendor.findOne({});
    const deliveryBoy = await DeliveryBoy.findOne({ approvalStatus: "APPROVED" });

    // 2. Create test order
    const dummyProdId = new mongoose.Types.ObjectId();
    const order = await Order.create({
      orderNumber: `BM-TEST-${timestamp}`,
      customer: testCustomer._id,
      vendor: vendor?._id,
      items: [
        {
          product: dummyProdId,
          productId: dummyProdId.toString(),
          name: "Organic Apples",
          price: 100,
          quantity: 2,
        },
      ],
      itemsTotal: 200,
      totalCount: 2,
      subtotal: 200,
      totalAmount: 250,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "PLACED",
      deliveryAddress: {
        fullName: "Test Customer",
        addressLine: "Kathmandu Central",
        city: "Kathmandu",
        phone: testCustomer.phone,
      },
    });
    console.log(`[OK] Created test order: #${order.orderNumber} for customer: ${testCustomer._id}`);

    // ── Test 1: Order Placed Successfully ──────────────────────────────────
    console.log("\n[Test 1] Testing 'Order Placed Successfully' notification...");
    const placedNotif = await notifyCustomerOrderPlaced(order);
    if (!placedNotif) throw new Error("Order placed notification returned null");
    
    let notifs = await Notification.find({ user: testCustomer._id });
    if (notifs.length !== 1 || notifs[0].data?.event !== "ORDER_PLACED") {
      throw new Error(`Expected 1 ORDER_PLACED notification, found ${notifs.length}`);
    }
    console.log(`[PASS] Order placed notification created: "${notifs[0].title}" - "${notifs[0].message}"`);

    // Test Idempotency on Order Placed (duplicate prevention)
    console.log("  Testing idempotency on repeat call...");
    const repeatPlaced = await notifyCustomerOrderPlaced(order);
    const countAfterRepeat = await Notification.countDocuments({ user: testCustomer._id });
    if (countAfterRepeat !== 1) {
      throw new Error(`Idempotency failed: Expected 1 notification, found ${countAfterRepeat}`);
    }
    console.log(`[PASS] Idempotency verified: Duplicate order placed notification prevented.`);

    // ── Test 2: Vendor Confirms Order (EXCLUDED - MUST NOT BE SHOWN) ───────
    console.log("\n[Test 2] Simulating Vendor Confirms Order (Status -> ACCEPTED)...");
    const countBeforeAccept = await Notification.countDocuments({ user: testCustomer._id });
    
    // Simulate vendor accepting the order (as implemented in updateOrderStatus)
    order.orderStatus = "ACCEPTED";
    order.acceptedAt = new Date();
    await order.save();

    // Verify NO customer-facing notification was created for ACCEPTED
    const countAfterAccept = await Notification.countDocuments({ user: testCustomer._id });
    if (countAfterAccept !== countBeforeAccept) {
      throw new Error(`VIOLATION: Vendor confirmation created a customer notification record!`);
    }
    console.log(`[PASS] Vendor confirmation strictly verified: 0 customer notifications created.`);

    // ── Test 3: Delivery Boy Assigned (EXCLUDED - MUST NOT BE SHOWN) ────────
    console.log("\n[Test 3] Simulating Delivery Boy Assigned...");
    const countBeforeAssign = await Notification.countDocuments({ user: testCustomer._id });

    // Simulate assignment (as in acceptAssignment)
    order.assignedDeliveryBoy = deliveryBoy?._id;
    await order.save();

    // Verify NO customer-facing notification was created for rider assignment
    const countAfterAssign = await Notification.countDocuments({ user: testCustomer._id });
    if (countAfterAssign !== countBeforeAssign) {
      throw new Error(`VIOLATION: Delivery partner assignment created a customer notification record!`);
    }
    console.log(`[PASS] Delivery partner assignment strictly verified: 0 customer notifications created.`);

    // ── Test 4: Order Picked Up ─────────────────────────────────────────────
    console.log("\n[Test 4] Testing 'Order Picked Up' notification...");
    order.pickedUpAt = new Date();
    await order.save();

    const pickedNotif = await notifyCustomerOrderPickedUp(order, deliveryBoy);
    if (!pickedNotif) throw new Error("Order picked up notification returned null");

    const pickedDocs = await Notification.find({
      user: testCustomer._id,
      "data.event": "ORDER_PICKED_UP",
    });
    if (pickedDocs.length !== 1) {
      throw new Error(`Expected 1 ORDER_PICKED_UP notification, found ${pickedDocs.length}`);
    }
    console.log(`[PASS] Order picked up notification created: "${pickedDocs[0].title}"`);

    // ── Test 5: Out for Delivery ────────────────────────────────────────────
    console.log("\n[Test 5] Testing 'Out for Delivery' notification...");
    order.orderStatus = "OUT_FOR_DELIVERY";
    await order.save();

    const ofdNotif = await notifyCustomerOrderOutForDelivery(order, deliveryBoy);
    if (!ofdNotif) throw new Error("Out for delivery notification returned null");

    const ofdDocs = await Notification.find({
      user: testCustomer._id,
      "data.event": "OUT_FOR_DELIVERY",
    });
    if (ofdDocs.length !== 1) {
      throw new Error(`Expected 1 OUT_FOR_DELIVERY notification, found ${ofdDocs.length}`);
    }
    console.log(`[PASS] Out for delivery notification created: "${ofdDocs[0].title}"`);

    // ── Test 6: Order Delivered Successfully ────────────────────────────────
    console.log("\n[Test 6] Testing 'Order Delivered Successfully' notification...");
    order.orderStatus = "DELIVERED";
    order.deliveredAt = new Date();
    await order.save();

    const deliveredNotif = await notifyCustomerOrderDelivered(order);
    if (!deliveredNotif) throw new Error("Order delivered notification returned null");

    const delDocs = await Notification.find({
      user: testCustomer._id,
      "data.event": "ORDER_DELIVERED",
    });
    if (delDocs.length !== 1) {
      throw new Error(`Expected 1 ORDER_DELIVERED notification, found ${delDocs.length}`);
    }
    console.log(`[PASS] Order delivered notification created: "${delDocs[0].title}"`);

    // ── Test 7: Order Cancelled ─────────────────────────────────────────────
    console.log("\n[Test 7] Testing 'Order Cancelled' notification...");
    const cancelOrder = await Order.create({
      orderNumber: `BM-CANCEL-${timestamp}`,
      customer: testCustomer._id,
      vendor: vendor?._id,
      items: order.items,
      itemsTotal: 200,
      totalCount: 2,
      subtotal: 200,
      totalAmount: 250,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "CANCELLED",
      deliveryAddress: order.deliveryAddress,
    });

    const cancelNotif = await notifyCustomerOrderCancelled(cancelOrder, "Customer changed mind");
    if (!cancelNotif) throw new Error("Order cancelled notification returned null");

    const cancelDocs = await Notification.find({
      user: testCustomer._id,
      "data.event": "ORDER_CANCELLED",
    });
    if (cancelDocs.length !== 1) {
      throw new Error(`Expected 1 ORDER_CANCELLED notification, found ${cancelDocs.length}`);
    }
    console.log(`[PASS] Order cancelled notification created: "${cancelDocs[0].title}" - "${cancelDocs[0].message}"`);

    // ── Test 8: Refund Status Updated ───────────────────────────────────────
    console.log("\n[Test 8] Testing 'Refund Status Updated' notification...");
    const dummyRefund = {
      _id: new mongoose.Types.ObjectId(),
      refundNumber: `REF-TST-${timestamp}`,
      amount: 250,
      status: "COMPLETED",
      customer: testCustomer._id,
    };

    const refundNotif = await notifyCustomerRefundStatusUpdated(
      order,
      dummyRefund,
      "COMPLETED",
      "Processed to UPI"
    );
    if (!refundNotif) throw new Error("Refund status notification returned null");

    const refundDocs = await Notification.find({
      user: testCustomer._id,
      category: "refunds",
    });
    if (refundDocs.length !== 1) {
      throw new Error(`Expected 1 refund notification, found ${refundDocs.length}`);
    }
    console.log(`[PASS] Refund notification created: "${refundDocs[0].title}" - "${refundDocs[0].message}"`);

    // ── Test 9: Strict Recipient Isolation ──────────────────────────────────
    console.log("\n[Test 9] Verifying Strict Recipient Isolation...");
    const otherCustomerNotifs = await Notification.find({ user: otherCustomer._id });
    if (otherCustomerNotifs.length !== 0) {
      throw new Error(`Isolation leak! Other customer received ${otherCustomerNotifs.length} notifications.`);
    }
    console.log(`[PASS] Recipient isolation verified: Other customer has 0 leaked notifications.`);

    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log("\n--- Cleaning up temporary test fixtures ---");
    await Notification.deleteMany({ user: { $in: [testCustomer._id, otherCustomer._id] } });
    await Order.deleteMany({ _id: { $in: [order._id, cancelOrder._id] } });
    await User.deleteMany({ _id: { $in: [testCustomer._id, otherCustomer._id] } });
    console.log("[OK] Cleanup completed.");

    console.log("\n================================================================================");
    console.log("   ALL CUSTOMER NOTIFICATION RULES PASSED WITH 100% SUCCESS! (9/9 TESTS)");
    console.log("================================================================================");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("\n[TEST FAILED]:", err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runCustomerNotificationTests();

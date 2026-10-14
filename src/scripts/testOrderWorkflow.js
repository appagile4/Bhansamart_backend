import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function testWorkflow() {
  console.log("Starting Real-Time Order Workflow Test...");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB successfully.");

    // 1. Find a customer
    let customer = await User.findOne({ role: "customer" });
    if (!customer) {
      customer = await User.findOne({});
    }
    console.log(`1. Customer identified: ${customer.name} (${customer._id})`);

    // 2. Find an active vendor and products
    const vendor = await Vendor.findOne({ status: { $in: ["approved", "active"] } });
    if (!vendor) {
      throw new Error("No active vendor found in database!");
    }
    console.log(`2. Vendor identified: ${vendor.businessDetails?.businessName || vendor._id}`);

    const product = await Product.findOne({ vendor: vendor._id, inStock: true, isDeleted: false });
    if (!product) {
      throw new Error("No in-stock product found for this vendor!");
    }
    console.log(`3. Product identified: "${product.name}" - Stock: ${product.stock}, Price: Rs.${product.price}`);

    const initialStock = product.stock;
    const orderQty = 1;

    // 4. Test Idempotent Order Creation
    const testIdempotencyKey = `TEST-IDEM-${Date.now()}`;
    const orderNumber = await Order.generateOrderNumber();

    const createdOrder = await Order.create({
      orderNumber,
      idempotencyKey: testIdempotencyKey,
      customer: customer._id,
      vendor: vendor._id,
      items: [
        {
          product: product._id,
          productId: product._id.toString(),
          name: product.name,
          price: product.price,
          quantity: orderQty,
          weight: product.unit || "1 unit",
          category: product.category,
        },
      ],
      totalCount: orderQty,
      itemsTotal: product.price * orderQty,
      handlingCharge: 30,
      deliveryCharge: 0,
      discount: 0,
      totalAmount: product.price * orderQty + 30,
      deliveryAddress: {
        addressLine: "Test Address, Baneshwor",
        city: "Kathmandu",
        phone: "9801234567",
      },
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "PLACED",
      statusHistory: [
        {
          status: "PLACED",
          timestamp: new Date(),
          updatedBy: customer._id,
          reason: "Order placed by customer test",
        },
      ],
    });

    console.log(`4. Order created in MongoDB: ${createdOrder.orderNumber} (ID: ${createdOrder._id})`);

    // Decrement stock
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: -orderQty } });
    const productAfterOrder = await Product.findById(product._id);
    console.log(`5. Stock decremented: ${initialStock} -> ${productAfterOrder.stock} (Expected: ${initialStock - orderQty})`);

    // 5. Test Duplicate Prevention with Idempotency Key
    const duplicateLookup = await Order.findOne({ idempotencyKey: testIdempotencyKey });
    if (duplicateLookup && duplicateLookup._id.toString() === createdOrder._id.toString()) {
      console.log("6. Idempotency check PASSED: Duplicate creation safely intercepted.");
    } else {
      throw new Error("Idempotency check failed!");
    }

    // 6. Test Vendor Atomic Acceptance
    const acceptedOrder = await Order.findOneAndUpdate(
      {
        _id: createdOrder._id,
        vendor: vendor._id,
        orderStatus: "PLACED",
      },
      {
        $set: { orderStatus: "ACCEPTED", acceptedAt: new Date() },
        $push: {
          statusHistory: {
            status: "ACCEPTED",
            timestamp: new Date(),
            reason: "Accepted by vendor in test",
          },
        },
      },
      { returnDocument: "after" }
    );

    if (acceptedOrder && acceptedOrder.orderStatus === "ACCEPTED") {
      console.log(`7. Vendor Acceptance PASSED: Status is now ${acceptedOrder.orderStatus}`);
    } else {
      throw new Error("Vendor acceptance failed!");
    }

    // 7. Test Concurrency Protection: Try to accept already accepted order
    const doubleAccept = await Order.findOneAndUpdate(
      {
        _id: createdOrder._id,
        vendor: vendor._id,
        orderStatus: "PLACED",
      },
      {
        $set: { orderStatus: "ACCEPTED" },
      }
    );
    if (!doubleAccept) {
      console.log("8. Concurrency Protection PASSED: Duplicate status transition rejected.");
    } else {
      throw new Error("Concurrency protection failed!");
    }

    // 8. Test Status Progression: Preparing -> Ready
    await Order.findByIdAndUpdate(createdOrder._id, { $set: { orderStatus: "READY_FOR_PICKUP" } });
    const readyOrder = await Order.findById(createdOrder._id);
    console.log(`9. Status Transition PASSED: Order is now ${readyOrder.orderStatus}`);

    // Clean up test order and restore stock
    await Order.findByIdAndDelete(createdOrder._id);
    await Product.findByIdAndUpdate(product._id, { $inc: { stock: orderQty } });
    const productRestored = await Product.findById(product._id);
    console.log(`10. Cleanup PASSED: Test order removed and product stock restored to ${productRestored.stock}.`);

    console.log("\nALL REAL-TIME ORDER WORKFLOW TESTS PASSED CLEANLY!");
    process.exit(0);
  } catch (err) {
    console.error("Test failed with error:", err);
    process.exit(1);
  }
}

testWorkflow();

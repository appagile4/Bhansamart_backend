import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { hashOTP } from "../utils/dispatchEngine.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function seedOrders() {
  console.log("================================================================================");
  console.log("   SEEDING CUSTOMER ORDERS FOR BHANSAMART");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB database.");

    // Find all customers (specifically including ayushmaanratan@gmail.com)
    let customers = await User.find({
      $or: [
        { email: "ayushmaanratan@gmail.com" },
        { role: "customer" },
      ],
    });

    if (customers.length === 0) {
      console.log("No customer found. Creating customer Ayushmaan Ratan...");
      const newCust = await User.create({
        name: "Ayushmaan Ratan",
        email: "ayushmaanratan@gmail.com",
        phone: "9801234567",
        role: "customer",
        isActive: true,
      });
      customers = [newCust];
    }

    const targetCustomer = customers.find((c) => c.email === "ayushmaanratan@gmail.com") || customers[0];
    console.log(`[OK] Target Customer: ${targetCustomer.name} (${targetCustomer.email})`);

    // Find vendors
    const vendors = await Vendor.find({ status: "approved" }).limit(3);
    if (vendors.length === 0) {
      console.error("No approved vendors found in DB.");
      process.exit(1);
    }
    const vendor1 = vendors[0];
    const vendor2 = vendors[1] || vendors[0];

    // Find products
    const products = await Product.find({ isDeleted: false }).limit(8);
    if (products.length === 0) {
      console.error("No products found in DB.");
      process.exit(1);
    }

    // Find delivery boy
    const deliveryBoy = await DeliveryBoy.findOne({ approvalStatus: "APPROVED" });

    // Customer delivery address
    const defaultAddress = {
      addressLine: "Baneshwor, Kathmandu, Bagmati, Nepal",
      city: "Kathmandu",
      street: "Main Street, House 14",
      houseNo: "14",
      landmark: "Near Baneshwor Chowk",
      phone: targetCustomer.phone || "9841234567",
      type: "Home",
    };

    const plainDeliveryOtp = "4829";
    const hashedDeliveryOtp = await hashOTP(plainDeliveryOtp);

    // ── 1. Order 1: LIVE OUT_FOR_DELIVERY ───────────────────────────────────
    const item1 = products[0];
    const item2 = products[1] || products[0];
    const ordNum1 = await Order.generateOrderNumber();
    const order1 = await Order.create({
      orderNumber: ordNum1,
      customer: targetCustomer._id,
      vendor: vendor1._id,
      items: [
        {
          product: item1._id,
          productId: item1._id.toString(),
          name: item1.name,
          price: item1.price,
          quantity: 2,
          total: item1.price * 2,
          imageUrl: item1.image || "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400",
          weight: "1 kg",
        },
        {
          product: item2._id,
          productId: item2._id.toString(),
          name: item2.name,
          price: item2.price,
          quantity: 1,
          total: item2.price,
          imageUrl: item2.image || "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=400",
          weight: "1 kg",
        },
      ],
      totalCount: 3,
      itemsTotal: item1.price * 2 + item2.price,
      handlingCharge: 15,
      deliveryCharge: 40,
      discount: 25,
      totalAmount: item1.price * 2 + item2.price + 15 + 40 - 25,
      deliveryAddress: defaultAddress,
      paymentMethod: "Cash on delivery",
      paymentStatus: "pending",
      orderStatus: "OUT_FOR_DELIVERY",
      assignedDeliveryBoy: deliveryBoy?._id || null,
      deliveryOtp: {
        code: hashedDeliveryOtp,
        displayCode: plainDeliveryOtp,
        attempts: 0,
      },
      customerDeliveryOtp: plainDeliveryOtp,
      statusHistory: [
        { status: "PLACED", timestamp: new Date(Date.now() - 35 * 60 * 1000), reason: "Order placed by customer" },
        { status: "ACCEPTED", timestamp: new Date(Date.now() - 30 * 60 * 1000), reason: "Store accepted order" },
        { status: "PREPARING", timestamp: new Date(Date.now() - 25 * 60 * 1000), reason: "Packing fresh items" },
        { status: "READY_FOR_PICKUP", timestamp: new Date(Date.now() - 15 * 60 * 1000), reason: "Order packaged" },
        { status: "OUT_FOR_DELIVERY", timestamp: new Date(Date.now() - 8 * 60 * 1000), reason: "Partner out for delivery" },
      ],
      estimatedDeliveryTime: "15-20 mins",
    });
    console.log(`[OK] Created Order 1: #${order1.orderNumber} (Status: OUT_FOR_DELIVERY, Amount: NPR ${order1.totalAmount})`);

    // ── 2. Order 2: PREPARING (Store accepted, being prepared) ─────────────
    const item3 = products[2] || products[0];
    const ordNum2 = await Order.generateOrderNumber();
    const order2 = await Order.create({
      orderNumber: ordNum2,
      customer: targetCustomer._id,
      vendor: vendor2._id,
      items: [
        {
          product: item3._id,
          productId: item3._id.toString(),
          name: item3.name,
          price: item3.price,
          quantity: 1,
          total: item3.price,
          imageUrl: item3.image || "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400",
          weight: "5 kg",
        },
      ],
      totalCount: 1,
      itemsTotal: item3.price,
      handlingCharge: 10,
      deliveryCharge: 30,
      discount: 0,
      totalAmount: item3.price + 10 + 30,
      deliveryAddress: defaultAddress,
      paymentMethod: "card",
      paymentStatus: "paid",
      orderStatus: "PREPARING",
      statusHistory: [
        { status: "PLACED", timestamp: new Date(Date.now() - 15 * 60 * 1000), reason: "Order placed" },
        { status: "ACCEPTED", timestamp: new Date(Date.now() - 10 * 60 * 1000), reason: "Accepted by store" },
        { status: "PREPARING", timestamp: new Date(Date.now() - 5 * 60 * 1000), reason: "Preparing package" },
      ],
    });
    console.log(`[OK] Created Order 2: #${order2.orderNumber} (Status: PREPARING, Amount: NPR ${order2.totalAmount})`);

    // ── 3. Order 3: DELIVERED (Past completed order) ────────────────────────
    const item4 = products[3] || products[0];
    const ordNum3 = await Order.generateOrderNumber();
    const order3 = await Order.create({
      orderNumber: ordNum3,
      customer: targetCustomer._id,
      vendor: vendor1._id,
      items: [
        {
          product: item4._id,
          productId: item4._id.toString(),
          name: item4.name,
          price: item4.price,
          quantity: 2,
          total: item4.price * 2,
          imageUrl: item4.image || "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400",
          weight: "1 kg",
        },
      ],
      totalCount: 2,
      itemsTotal: item4.price * 2,
      handlingCharge: 10,
      deliveryCharge: 30,
      discount: 20,
      totalAmount: item4.price * 2 + 10 + 30 - 20,
      deliveryAddress: defaultAddress,
      paymentMethod: "esewa",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      assignedDeliveryBoy: deliveryBoy?._id || null,
      statusHistory: [
        { status: "PLACED", timestamp: new Date(Date.now() - 49 * 60 * 60 * 1000), reason: "Placed" },
        { status: "ACCEPTED", timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000), reason: "Accepted" },
        { status: "DELIVERED", timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000 + 40 * 60 * 1000), reason: "Delivered successfully" },
      ],
    });
    console.log(`[OK] Created Order 3: #${order3.orderNumber} (Status: DELIVERED, Amount: NPR ${order3.totalAmount})`);

    // ── Also seed orders for all other customers in DB ─────────────────────
    for (const cust of customers) {
      if (cust._id.toString() !== targetCustomer._id.toString()) {
        const oNum = await Order.generateOrderNumber();
        await Order.create({
          orderNumber: oNum,
          customer: cust._id,
          vendor: vendor1._id,
          items: [
            {
              product: item1._id,
              productId: item1._id.toString(),
              name: item1.name,
              price: item1.price,
              quantity: 1,
              total: item1.price,
            },
          ],
          totalCount: 1,
          itemsTotal: item1.price,
          totalAmount: item1.price,
          deliveryAddress: defaultAddress,
          paymentMethod: "Cash on delivery",
          paymentStatus: "pending",
          orderStatus: "PLACED",
        });
        console.log(`[OK] Created Order for Customer ${cust.name}: #${oNum}`);
      }
    }

    console.log("\n================================================================================");
    console.log("   ✅ CUSTOMER ORDERS SEEDED SUCCESSFULLY!");
    console.log("================================================================================");
    console.log(`Customer: ${targetCustomer.name} (${targetCustomer.email})`);
    console.log(`Orders visible in My Orders: 3 orders`);
    console.log(`1. #${order1.orderNumber} - OUT FOR DELIVERY (Live tracker active)`);
    console.log(`2. #${order2.orderNumber} - PREPARING (Store accepted)`);
    console.log(`3. #${order3.orderNumber} - DELIVERED (Past order)`);
    console.log("================================================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding customer orders failed:", err);
    process.exit(1);
  }
}

seedOrders();

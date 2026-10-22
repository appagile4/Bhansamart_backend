import "dotenv/config";
import mongoose from "mongoose";
import Category from "../models/Category.js";
import Ticket from "../models/Ticket.js";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";

async function seedAdminData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[OK] Connected to MongoDB");

    // 1. Seed Categories & Subcategories
    const categoryCount = await Category.countDocuments();
    if (categoryCount === 0) {
      const cat1 = await Category.create({
        name: "Fresh Vegetables",
        slug: "fresh-vegetables",
        description: "Farm fresh organic green vegetables & herbs",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400&q=80",
        level: 0,
        displayOrder: 1,
      });

      await Category.create({
        name: "Leafy Greens",
        slug: "leafy-greens",
        parentCategory: cat1._id,
        level: 1,
        displayOrder: 1,
      });

      await Category.create({
        name: "Root Vegetables",
        slug: "root-vegetables",
        parentCategory: cat1._id,
        level: 1,
        displayOrder: 2,
      });

      const cat2 = await Category.create({
        name: "Dairy & Eggs",
        slug: "dairy-and-eggs",
        description: "Fresh farm milk, curd, paneer & eggs",
        image: "https://images.unsplash.com/photo-1528750997573-59b89d56f4f7?w=400&q=80",
        level: 0,
        displayOrder: 2,
      });

      await Category.create({
        name: "Fresh Milk & Paneer",
        slug: "milk-and-paneer",
        parentCategory: cat2._id,
        level: 1,
        displayOrder: 1,
      });

      console.log("[OK] Seeded 2 Root Categories and 3 Subcategories.");
    }

    // 2. Seed Sample Support Ticket if none exist
    const ticketCount = await Ticket.countDocuments();
    if (ticketCount === 0) {
      const customer = await User.findOne({ role: "customer" });
      const vendor = await Vendor.findOne();
      const order = await Order.findOne();

      if (customer) {
        const ticketNumber = await Ticket.generateTicketNumber();
        await Ticket.create({
          ticketNumber,
          raisedBy: customer._id,
          userRole: "customer",
          category: "order",
          priority: "high",
          subject: "Delivery timing inquiry for fresh groceries",
          description: "Could you please confirm if the delivery partner has departed with my order?",
          vendor: vendor?._id || null,
          order: order?._id || null,
          status: "OPEN",
          messages: [
            {
              sender: customer._id,
              senderRole: "customer",
              message: "Hi support team, just checking on my expected arrival window. Thanks!",
              createdAt: new Date(),
            },
          ],
        });
        console.log(`[OK] Seeded Sample Support Ticket: #${ticketNumber}`);
      }
    }

    console.log("✅ Admin sample data seeding complete!");
    process.exit(0);
  } catch (err) {
    console.error("[FAIL] Error seeding admin data:", err);
    process.exit(1);
  }
}

seedAdminData();

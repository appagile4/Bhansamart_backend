import dotenv from "dotenv";
import mongoose from "mongoose";
import Brand from "../models/Brand.js";

dotenv.config();

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  const testCats = ["Grocery & Kitchen", "Snacks & Drinks", "Beauty & Personal Care", "Baby", "School, Office & Stationery"];
  
  for (const cat of testCats) {
    const cleanCat = String(cat).trim();
    // Test regex query
    const query = {
      status: "APPROVED",
      $or: [
        { categories: { $regex: cleanCat, $options: "i" } },
        { categories: { $size: 0 } },
        { categories: { $exists: false } },
      ],
    };
    const brands = await Brand.find(query).lean();
    console.log(`Cat: "${cat}" -> ${brands.length} brands:`, brands.map(b => b.name));
  }
  process.exit(0);
}

test();

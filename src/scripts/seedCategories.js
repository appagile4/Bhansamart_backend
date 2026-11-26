import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Category from "../models/Category.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

const CATEGORIES = [
  { name: "Paan Corner", slug: "paan-corner", displayOrder: 1 },
  { name: "Dairy, Bread & Eggs", slug: "dairy-bread-eggs", displayOrder: 2 },
  { name: "Fruits & Vegetables", slug: "fruits-vegetables", displayOrder: 3 },
  { name: "Cold Drinks & Juices", slug: "cold-drinks-juices", displayOrder: 4 },
  { name: "Snacks & Munchies", slug: "snacks-munchies", displayOrder: 5 },
  { name: "Breakfast & Instant Food", slug: "breakfast-instant-food", displayOrder: 6 },
  { name: "Sweet Tooth", slug: "sweet-tooth", displayOrder: 7 },
  { name: "Bakery & Biscuits", slug: "bakery-biscuits", displayOrder: 8 },
  { name: "Tea, Coffee & Milk Drinks", slug: "tea-coffee-milk-drinks", displayOrder: 9 },
  { name: "Atta, Rice & Dal", slug: "atta-rice-dal", displayOrder: 10 },
  { name: "Masala, Oil & More", slug: "masala-oil-more", displayOrder: 11 },
  { name: "Sauces & Spreads", slug: "sauces-spreads", displayOrder: 12 },
  { name: "Chicken, Meat & Fish", slug: "chicken-meat-fish", displayOrder: 13 },
  { name: "Organic & Healthy Living", slug: "organic-healthy-living", displayOrder: 14 },
  { name: "Baby Care", slug: "baby-care", displayOrder: 15 },
  { name: "Pharma & Wellness", slug: "pharma-wellness", displayOrder: 16 },
  { name: "Cleaning Essentials", slug: "cleaning-essentials", displayOrder: 17 },
  { name: "Home & Office", slug: "home-office", displayOrder: 18 },
  { name: "Personal Care", slug: "personal-care", displayOrder: 19 },
  { name: "Pet Care", slug: "pet-care", displayOrder: 20 },
];

async function seedCategories() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGO_URI is missing in .env");
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB for Category Seeding.");

  for (const cat of CATEGORIES) {
    const filter = { slug: cat.slug, parentCategory: null };
    const update = {
      $set: {
        name: cat.name,
        slug: cat.slug,
        image: `/images/categories/${cat.slug}.png`,
        displayOrder: cat.displayOrder,
        level: 0,
        parentCategory: null,
        isActive: true,
      },
      $setOnInsert: {
        description: `${cat.name} essentials delivered in 15-25 minutes`,
        productCount: 0,
      },
    };

    const result = await Category.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    console.log(`[OK] Seeded category: ${result.name} (order ${result.displayOrder})`);
  }

  console.log("\nAll 20 Categories successfully synchronized in MongoDB!");
  await mongoose.disconnect();
}

seedCategories().catch((err) => {
  console.error("Error seeding categories:", err);
  process.exit(1);
});

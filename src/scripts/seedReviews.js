import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../models/Product.js";
import Review from "../models/Review.js";

dotenv.config();

const SAMPLE_REVIEWS_DATA = [
  {
    userName: "Aakash Shrestha",
    rating: 5,
    comment:
      "I absolutely love this product! It has the perfect balance of richness and quality, with great flavor that truly satisfies my cravings.",
    isVerifiedBuyer: true,
  },
  {
    userName: "Sunita Thapa",
    rating: 5,
    comment:
      "Great packaging, super fast delivery and very fresh. Will definitely reorder again!",
    isVerifiedBuyer: true,
  },
  {
    userName: "Bikash Adhikari",
    rating: 4,
    comment:
      "Good value for money. Taste and texture are top-notch. Highly recommended for daily use.",
    isVerifiedBuyer: true,
  },
  {
    userName: "Pooja Sharma",
    rating: 5,
    comment:
      "Authentic product and genuine quality. Arrived in pristine condition.",
    isVerifiedBuyer: true,
  },
];

async function seedReviews() {
  try {
    const mongoUri =
      process.env.MONGODB_URI || "mongodb://localhost:27017/bhansamart";
    await mongoose.connect(mongoUri);
    console.log("[Seed Reviews] Connected to MongoDB");

    const products = await Product.find({ isDeleted: false });
    console.log(`[Seed Reviews] Found ${products.length} products`);

    await Review.deleteMany({});
    console.log("[Seed Reviews] Cleared previous reviews");

    for (const prod of products) {
      for (const rev of SAMPLE_REVIEWS_DATA) {
        await Review.create({
          product: prod._id,
          userName: rev.userName,
          rating: rev.rating,
          comment: rev.comment.replace(
            "this product",
            prod.name
          ),
          isVerifiedBuyer: rev.isVerifiedBuyer,
        });
      }
      await Review.calcAverageRatings(prod._id);
    }

    console.log("[Seed Reviews] Successfully seeded sample reviews for all products!");
    process.exit(0);
  } catch (err) {
    console.error("[Seed Reviews] Error:", err);
    process.exit(1);
  }
}

seedReviews();

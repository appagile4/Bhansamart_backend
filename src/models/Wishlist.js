import mongoose from "mongoose";

const wishlistItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: false,
    },
    productId: {
      type: String,
      required: [true, "Product ID is required"],
      index: true,
    },
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Product price is required"],
    },
    originalPrice: {
      type: Number,
      default: 0,
    },
    image: {
      type: String,
      default: "",
    },
    imageUrl: {
      type: String,
      default: "",
    },
    weight: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "",
    },
    subCategory: {
      type: String,
      default: "",
    },
    rating: {
      type: Number,
      default: 4.5,
    },
    reviewsCount: {
      type: Number,
      default: 0,
    },
    isVeg: {
      type: Boolean,
      default: true,
    },
    discountPct: {
      type: Number,
      default: 0,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const wishlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required for wishlist"],
      unique: true,
      index: true,
    },
    items: [wishlistItemSchema],
  },
  {
    timestamps: true,
  }
);

const Wishlist = mongoose.model("Wishlist", wishlistSchema);

export default Wishlist;

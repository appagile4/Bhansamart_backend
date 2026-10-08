import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema(
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
      min: [0, "Price cannot be negative"],
    },
    originalPrice: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
      default: 1,
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
    isVeg: {
      type: Boolean,
      default: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required for cart"],
      unique: true,
      index: true,
    },
    items: [cartItemSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Helper method to compute summary metrics
cartSchema.methods.calculateTotals = function () {
  const totalCount = this.items.reduce((sum, it) => sum + it.quantity, 0);
  const totalPrice = this.items.reduce(
    (sum, it) => sum + it.price * it.quantity,
    0
  );
  const totalOriginalPrice = this.items.reduce(
    (sum, it) => sum + (it.originalPrice || it.price) * it.quantity,
    0
  );
  const totalSavings = Math.max(0, totalOriginalPrice - totalPrice);

  return {
    totalCount,
    totalPrice,
    totalOriginalPrice,
    totalSavings,
  };
};

const Cart = mongoose.model("Cart", cartSchema);

export default Cart;

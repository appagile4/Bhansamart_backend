import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: null },
    altText: { type: String, default: "" },
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema(
  {
    type: { type: String, default: "Standard" },
    weightUnit: { type: String, default: "kg" },
    weightValue: { type: String, default: "1" },
    color: { type: String, default: "" },
    price: { type: Number, default: 0 },
    sku: { type: String, default: "" },
    stock: { type: Number, default: 0 },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // Vendor reference
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // 1. General Information
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
    },
    shortDescription: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      required: [true, "Product category is required"],
      index: true,
    },
    subCategory: {
      type: String,
      default: "",
      index: true,
    },
    supplierName: {
      type: String,
      default: "",
    },
    brand: {
      type: String,
      default: "Generic / Store Brand",
      index: true,
    },
    expirationDate: {
      type: String,
      default: "",
    },

    // 2. Pricing & Discounts
    price: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0, "Price cannot be negative"],
    },
    originalPrice: {
      type: Number,
      default: 0,
      min: [0, "Original price cannot be negative"],
    },
    discountCategory: {
      type: String,
      default: "No Discount",
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // 3. Inventory & SKU
    sku: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    reorderLevel: {
      type: Number,
      default: 5,
      min: 0,
    },
    unit: {
      type: String,
      default: "1 kg",
    },
    inStock: {
      type: Boolean,
      default: true,
    },

    // 4. Media (Images on Cloudinary)
    images: [imageSchema],
    videoUrl: {
      type: String,
      default: "",
    },

    // 5. Variants
    variants: [variantSchema],

    // 6. Tags
    tags: [
      {
        type: String,
        trim: true,
        index: true,
      },
    ],

    // 7. Status & Visibility
    status: {
      type: String,
      enum: ["Active", "Not Active", "Schedule", "Draft", "archived"],
      default: "Active",
      index: true,
    },
    visibility: {
      isFeatured: { type: Boolean, default: false },
      isBestSeller: { type: Boolean, default: false },
      isNewArrival: { type: Boolean, default: false },
    },

    // 8. Performance Metrics
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
    ordersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    conversionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    returnRefundRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // 9. Meta
    ratingsAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingsCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Auto-compute discount and performance metrics before save
productSchema.pre("save", function () {
  if (this.originalPrice && this.originalPrice > this.price) {
    this.discount = parseFloat(
      (((this.originalPrice - this.price) / this.originalPrice) * 100).toFixed(2)
    );
  } else {
    this.discount = 0;
  }
  if (this.stock <= 0) {
    this.inStock = false;
  }
  // Auto-calculate conversion rate and return/refund rate
  if (this.views > 0) {
    this.conversionRate = Math.min(
      100,
      Math.round((this.ordersCount / this.views) * 100)
    );
  } else {
    this.conversionRate = 0;
  }
  if (this.ordersCount > 0) {
    this.returnRefundRate = Math.min(
      100,
      Math.round((this.refundsCount / this.ordersCount) * 100)
    );
  } else {
    this.returnRefundRate = 0;
  }
});

// ── High-Performance Compound Indexes for Catalog & Pagination ──
productSchema.index({ category: 1, isDeleted: 1, status: 1, createdAt: -1 });
productSchema.index({ category: 1, subCategory: 1, isDeleted: 1, status: 1 });
productSchema.index({ category: 1, price: 1, isDeleted: 1 });
productSchema.index({ category: 1, ratingsCount: -1, ratingsAverage: -1 });
productSchema.index({ vendor: 1, isDeleted: 1, createdAt: -1 });
productSchema.index({ isDeleted: 1, status: 1, inStock: 1 });
productSchema.index({
  name: "text",
  category: "text",
  subCategory: "text",
  brand: "text",
  tags: "text",
});

const Product = mongoose.model("Product", productSchema);

export default Product;

import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    logo: {
      type: mongoose.Schema.Types.Mixed,
      default: { url: "", publicId: null, source: "upload" },
    },
    categories: [
      {
        type: String,
        trim: true,
      },
    ],
    description: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    isGlobal: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdByVendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
    createdByUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    metadata: {
      origin: { type: String, default: "vendor_panel" },
      website: { type: String, default: "" },
    },
  },
  {
    timestamps: true,
  }
);

brandSchema.index({ categories: 1, status: 1 });
brandSchema.index({ name: "text", description: "text" });

const Brand = mongoose.models.Brand || mongoose.model("Brand", brandSchema);

export default Brand;

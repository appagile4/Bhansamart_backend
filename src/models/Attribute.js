import mongoose from "mongoose";

const attributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Attribute name is required"],
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
    categories: [
      {
        type: String,
        trim: true,
      },
    ],
    values: [
      {
        type: String,
        trim: true,
      },
    ],
    type: {
      type: String,
      enum: ["single", "multiple", "text"],
      default: "single",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
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
    description: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

attributeSchema.index({ categories: 1, status: 1 });
attributeSchema.index({ name: "text" });

const Attribute =
  mongoose.models.Attribute || mongoose.model("Attribute", attributeSchema);

export default Attribute;

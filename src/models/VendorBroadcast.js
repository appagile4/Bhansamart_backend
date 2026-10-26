import mongoose from "mongoose";

const vendorBroadcastSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderName: {
      type: String,
      default: "",
    },
    senderEmail: {
      type: String,
      default: "",
    },
    senderRole: {
      type: String,
      enum: ["superadmin", "admin"],
      default: "admin",
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
    },
    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    notificationType: {
      type: String,
      enum: [
        "GENERAL",
        "ANNOUNCEMENT",
        "ORDER_UPDATE",
        "PROMOTION",
        "IMPORTANT_NOTICE",
      ],
      default: "ANNOUNCEMENT",
    },
    targetType: {
      type: String,
      enum: ["ASSIGNED_VENDORS", "SPECIFIC_VENDORS", "ALL_VENDORS"],
      required: true,
      index: true,
    },
    targetVendorIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    recipientCount: {
      type: Number,
      default: 0,
    },
    deliveredVendorIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    failedVendorIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
      },
    ],
    status: {
      type: String,
      enum: ["QUEUED", "PROCESSING", "SENT", "FAILED"],
      default: "SENT",
      index: true,
    },
    imageUrl: {
      type: String,
      default: "",
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
  },
  { timestamps: true }
);

vendorBroadcastSchema.index({ sender: 1, createdAt: -1 });
vendorBroadcastSchema.index({ createdAt: -1 });

const VendorBroadcast =
  mongoose.models.VendorBroadcast ||
  mongoose.model("VendorBroadcast", vendorBroadcastSchema);

export default VendorBroadcast;

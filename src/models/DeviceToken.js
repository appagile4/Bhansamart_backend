import mongoose from "mongoose";

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Associated user is required"],
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      default: null,
      index: true,
    },
    role: {
      type: String,
      enum: ["customer", "user", "vendor", "admin", "superadmin", "delivery_boy"],
      default: "customer",
      index: true,
    },
    token: {
      type: String,
      required: [true, "Push token is required"],
      unique: true,
      trim: true,
      index: true,
    },
    tokenType: {
      type: String,
      enum: ["expo", "fcm", "apns", "web"],
      default: "expo",
    },
    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
      index: true,
    },
    deviceId: {
      type: String,
      trim: true,
      default: "",
    },
    deviceName: {
      type: String,
      trim: true,
      default: "",
    },
    appVersion: {
      type: String,
      trim: true,
      default: "1.0.0",
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    webSubscription: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

deviceTokenSchema.index({ user: 1, isActive: 1 });
deviceTokenSchema.index({ vendor: 1, isActive: 1 });
deviceTokenSchema.index({ deliveryBoy: 1, isActive: 1 });
deviceTokenSchema.index({ role: 1, isActive: 1 });

const DeviceToken = mongoose.model("DeviceToken", deviceTokenSchema);

export default DeviceToken;

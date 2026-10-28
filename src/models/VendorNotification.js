import mongoose from "mongoose";

const vendorNotificationSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "NEW_ORDER",
        "ORDER_ACCEPTED",
        "ORDER_PREPARING",
        "ORDER_PICKED_UP",
        "ORDER_OUT_FOR_DELIVERY",
        "ORDER_DELIVERED",
        "ORDER_CANCELLED",
        "PAYMENT_RECEIVED",
        "COD_COLLECTED",
        "COD_SUBMITTED",
        "COD_DISCREPANCY",
        "WITHDRAWAL_UPDATE",
        "REFUND_PROCESSED",
        "REFUND_REQUESTED",
        "SYSTEM",
        "GENERAL",
        "ANNOUNCEMENT",
        "ORDER_UPDATE",
        "PROMOTION",
        "IMPORTANT_NOTICE",
        "BROADCAST",
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

vendorNotificationSchema.index({ vendor: 1, isRead: 1, createdAt: -1 });

const VendorNotification =
  mongoose.models.VendorNotification ||
  mongoose.model("VendorNotification", vendorNotificationSchema);

export default VendorNotification;

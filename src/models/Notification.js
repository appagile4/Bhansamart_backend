import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Notification message is required"],
      trim: true,
    },
    type: {
      type: String,
      enum: [
        "referral_success",
        "referral_reward",
        "welcome_reward",
        "order",
        "refund",
        "reward",
        "offer",
        "system",
        "staff_order",
        "staff_withdrawal",
        "staff_brand",
        "staff_refund",
        "staff_delivery",
        "staff_cod",
        "staff_ticket",
        "staff_alert",
        "announcement",
        "broadcast",
        "delivery_request_received",
        "delivery_request_expired",
        "delivery_assignment_confirmed",
        "delivery_pickup_reminder",
        "delivery_handover_otp_available",
        "delivery_out_for_delivery",
        "delivery_completed",
        "delivery_cancelled",
        "delivery_earnings_updated",
        "delivery_payout_updated",
        "delivery_account_verification_updated",
        "delivery_portal_announcement",
      ],
      default: "system",
      index: true,
    },
    category: {
      type: String,
      enum: [
        "all",
        "orders",
        "refunds",
        "delivery",
        "payments",
        "account",
        "announcements",
        "system",
      ],
      default: "system",
      index: true,
    },
    targetRole: {
      type: String,
      enum: ["customer", "vendor", "delivery_boy", "staff", "admin"],
      default: "customer",
      index: true,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      index: true,
      default: null,
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
    outboxStatus: {
      type: String,
      enum: ["PENDING", "SENT", "FAILED"],
      default: "PENDING",
      index: true,
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

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;

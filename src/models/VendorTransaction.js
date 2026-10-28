import mongoose from "mongoose";

const vendorTransactionSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
      default: null,
    },
    refund: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Refund",
      index: true,
      default: null,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      index: true,
      default: null,
    },
    type: {
      type: String,
      enum: [
        "ORDER_EARNING",
        "COD_COLLECTION",
        "COD_HANDOVER",
        "WITHDRAWAL",
        "PLATFORM_FEE",
        "DIRECT_QR_PAYMENT",
        "REFUND_DEDUCTION",
        "COMMISSION_REVERSAL",
        "COMMISSION_DEDUCTION",
        "RECOVERY_ADJUSTMENT",
        "VENDOR_DIRECT_REFUND",
        "RETURN_PICKUP_CHARGE",
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    grossAmount: {
      type: Number,
      default: 0,
    },
    commission: {
      type: Number,
      default: 0,
    },
    commissionRate: {
      type: Number,
      default: 0.015,
    },
    commissionBase: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      default: "Cash on delivery",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "SETTLED",
        "CASH_IN_CUSTODY",
        "SUBMITTED",
        "COMPLETED",
        "FAILED",
        "DIRECT_SETTLED",
        "REVERSED",
        "RECOVERED",
      ],
      default: "SETTLED",
      index: true,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    notes: {
      type: String,
      default: "",
    },
    bankReference: {
      type: String,
      default: "",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    internalNotes: {
      type: String,
      default: "",
    },
    escalationStatus: {
      type: String,
      enum: ["PENDING_REVIEW", "EXAMINED_ESCALATED", "INFO_REQUESTED", "SETTLED", "REJECTED"],
      default: "PENDING_REVIEW",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

// Indexes for fast lookup
vendorTransactionSchema.index({ vendor: 1, createdAt: -1 });
vendorTransactionSchema.index({ vendor: 1, type: 1 });
vendorTransactionSchema.index({ vendor: 1, status: 1 });

const VendorTransaction =
  mongoose.models.VendorTransaction ||
  mongoose.model("VendorTransaction", vendorTransactionSchema);

export default VendorTransaction;

import mongoose from "mongoose";

const refundItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    imageUrl: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    refundNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    claimType: {
      type: String,
      enum: [
        "CANCELLATION",
        "CANCEL_PRE_DISPATCH",
        "RETURN",
        "RETURN_REFUND",
        "REPLACEMENT",
        "DEFECTIVE",
        "DEFECTIVE_CLAIM",
        "WRONG_ITEM",
      ],
      default: "CANCELLATION",
      index: true,
    },
    items: [refundItemSchema],
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPaymentMethod: {
      type: String,
      default: "Cash on delivery",
    },
    vendorDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionReversal: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionRate: {
      type: Number,
      default: 0.015,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    proofImages: [{ type: String }],
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "APPROVED",
        "PROCESSING",
        "COMPLETED",
        "REJECTED",
        "FAILED",
      ],
      default: "REQUESTED",
      index: true,
    },
    gatewayRefundId: {
      type: String,
      default: "",
    },
    customerPayoutDetails: {
      method: {
        type: String,
        enum: ["GATEWAY_REVERSAL", "UPI", "BANK_TRANSFER", "WALLET", "NONE"],
        default: "GATEWAY_REVERSAL",
      },
      upiId: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      payoutReference: { type: String, default: "" },
      payoutCompletedAt: { type: Date, default: null },
    },
    replacementOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminNotes: {
      type: String,
      default: "",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast lookup
refundSchema.index({ customer: 1, createdAt: -1 });
refundSchema.index({ vendor: 1, createdAt: -1 });
refundSchema.index({ order: 1, status: 1 });

// Helper to generate human-readable refund number
refundSchema.statics.generateRefundNumber = async function () {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const random = Math.floor(1000 + Math.random() * 9000);
  let refundNumber = `REF-${dateStr}-${random}`;

  let exists = await this.findOne({ refundNumber });
  while (exists) {
    const newRandom = Math.floor(1000 + Math.random() * 9000);
    refundNumber = `REF-${dateStr}-${newRandom}`;
    exists = await this.findOne({ refundNumber });
  }

  return refundNumber;
};

const Refund = mongoose.models.Refund || mongoose.model("Refund", refundSchema);

export default Refund;

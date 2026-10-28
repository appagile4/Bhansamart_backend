import mongoose from "mongoose";

const codHandoverSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      required: true,
      index: true,
    },
    orders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    amountDue: {
      type: Number,
      required: true,
      min: 0,
    },
    amountSubmitted: {
      type: Number,
      required: true,
      min: 1,
    },
    remainingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    vendorConfirmed: {
      type: Boolean,
      default: true,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: [
        "HANDOVER_PENDING",
        "HANDED_OVER",
        "VENDOR_CONFIRMED",
        "DISCREPANCY_REPORTED",
      ],
      default: "VENDOR_CONFIRMED",
      index: true,
    },
    discrepancy: {
      hasDiscrepancy: { type: Boolean, default: false },
      expectedAmount: { type: Number, default: 0 },
      submittedAmount: { type: Number, default: 0 },
      shortfall: { type: Number, default: 0 },
      reason: { type: String, default: "" },
      reportedAt: { type: Date, default: null },
      reportedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
    paymentMode: {
      type: String,
      enum: ["CASH", "UPI", "BANK_TRANSFER"],
      default: "CASH",
    },
    notes: {
      type: String,
      default: "",
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
    },
    auditHistory: [
      {
        action: { type: String, required: true },
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        role: { type: String, default: "" },
        notes: { type: String, default: "" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Indexes
codHandoverSchema.index({ vendor: 1, createdAt: -1 });
codHandoverSchema.index({ deliveryBoy: 1, createdAt: -1 });

// Helper to generate unique receipt numbers
codHandoverSchema.statics.generateReceiptNumber = async function () {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const random = Math.floor(1000 + Math.random() * 9000);
  let receiptNumber = `COD-REC-${dateStr}-${random}`;

  let exists = await this.findOne({ receiptNumber });
  while (exists) {
    const newRandom = Math.floor(1000 + Math.random() * 9000);
    receiptNumber = `COD-REC-${dateStr}-${newRandom}`;
    exists = await this.findOne({ receiptNumber });
  }

  return receiptNumber;
};

const CodHandover =
  mongoose.models.CodHandover ||
  mongoose.model("CodHandover", codHandoverSchema);

export default CodHandover;

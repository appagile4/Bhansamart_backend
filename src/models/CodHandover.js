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

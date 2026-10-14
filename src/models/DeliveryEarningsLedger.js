import mongoose from "mongoose";

const deliveryEarningsLedgerSchema = new mongoose.Schema(
  {
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      required: [true, "Delivery boy ID is required"],
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Order ID is required"],
    },
    basePay: {
      type: Number,
      required: true,
      default: 40,
      min: 0,
    },
    distancePay: {
      type: Number,
      default: 20,
      min: 0,
    },
    peakPay: {
      type: Number,
      default: 0,
      min: 0,
    },
    customerTip: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarnings: {
      type: Number,
      required: true,
      min: 0,
    },
    distanceKm: {
      type: Number,
      default: 1.5,
    },
    settlementStatus: {
      type: String,
      enum: ["PENDING", "SETTLED"],
      default: "PENDING",
      index: true,
    },
    settledAt: {
      type: Date,
    },
    settlementBatchId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

deliveryEarningsLedgerSchema.index({ deliveryBoy: 1, createdAt: -1 });
deliveryEarningsLedgerSchema.index({ order: 1 }, { unique: true });

const DeliveryEarningsLedger =
  mongoose.models.DeliveryEarningsLedger ||
  mongoose.model("DeliveryEarningsLedger", deliveryEarningsLedgerSchema);

export default DeliveryEarningsLedger;

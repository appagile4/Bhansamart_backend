import mongoose from "mongoose";

const securityDepositLedgerSchema = new mongoose.Schema(
  {
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      required: [true, "Delivery boy ID is required"],
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 1000,
      min: 1000,
    },
    currency: {
      type: String,
      default: "INR", // or NPR as appropriate for region
    },
    type: {
      type: String,
      enum: ["DEPOSIT_PAYMENT", "DEPOSIT_REFUND"],
      default: "DEPOSIT_PAYMENT",
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUND_REQUESTED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },
    paymentGateway: {
      type: String,
      enum: ["eSewa", "Khalti", "Razorpay", "Stripe", "MockGateway"],
      default: "MockGateway",
    },
    transactionId: {
      type: String,
      required: [true, "Transaction ID is required"],
      unique: true,
      index: true,
    },
    gatewayReference: {
      type: String,
      default: "",
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    paidAt: {
      type: Date,
    },
    refundReason: {
      type: String,
      default: "",
    },
    refundProcessedAt: {
      type: Date,
    },
    refundApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

securityDepositLedgerSchema.index({ deliveryBoy: 1, createdAt: -1 });

const SecurityDepositLedger =
  mongoose.models.SecurityDepositLedger ||
  mongoose.model("SecurityDepositLedger", securityDepositLedgerSchema);

export default SecurityDepositLedger;

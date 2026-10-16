import mongoose from "mongoose";

const rewardTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },
    referral: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Referral",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT", "REVERSAL"],
      required: [true, "Transaction type is required"],
      index: true,
    },
    reason: {
      type: String,
      required: [true, "Reason is required"],
      trim: true,
    },
    points: {
      type: Number,
      required: [true, "Points amount is required"],
      min: [1, "Points amount must be a positive integer"],
      validate: {
        validator: Number.isInteger,
        message: "Points must be an integer",
      },
    },
    balanceAfter: {
      type: Number,
      required: [true, "Balance after transaction is required"],
      min: 0,
    },
    idempotencyKey: {
      type: String,
      required: [true, "Idempotency key is required"],
      unique: true,
      index: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["COMPLETED", "REVERSED", "PENDING"],
      default: "COMPLETED",
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound indexes for user query and ledger queries
rewardTransactionSchema.index({ user: 1, createdAt: -1 });
rewardTransactionSchema.index({ user: 1, type: 1, createdAt: -1 });

const RewardTransaction = mongoose.model(
  "RewardTransaction",
  rewardTransactionSchema
);

export default RewardTransaction;

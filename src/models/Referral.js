import mongoose from "mongoose";

const referralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Referrer is required"],
      index: true,
    },
    referred: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Referred user is required"],
      unique: true, // Exactly ONE referral attribution per referred user
      index: true,
    },
    referralCode: {
      type: String,
      required: [true, "Referral code snapshot is required"],
      trim: true,
      uppercase: true,
    },
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReferralCampaign",
      default: null,
      index: true,
    },
    referrerReward: {
      type: Number,
      required: true,
      min: 0,
      default: 100,
    },
    referredReward: {
      type: Number,
      required: true,
      min: 0,
      default: 50,
    },
    status: {
      type: String,
      enum: ["PENDING", "REWARDED", "REJECTED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },
    rewardStatus: {
      type: String,
      enum: ["NOT_STARTED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "NOT_STARTED",
      index: true,
    },
    rewardedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Prevent self-referral at schema validation level
referralSchema.pre("validate", function () {
  if (
    this.referrer &&
    this.referred &&
    this.referrer.toString() === this.referred.toString()
  ) {
    this.invalidate("referred", "Self-referrals are strictly prohibited.");
  }
});

// Compound indexes
referralSchema.index({ referrer: 1, createdAt: -1 });
referralSchema.index({ status: 1, rewardStatus: 1 });

const Referral = mongoose.model("Referral", referralSchema);

export default Referral;

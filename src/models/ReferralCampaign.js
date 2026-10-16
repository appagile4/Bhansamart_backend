import mongoose from "mongoose";

const referralCampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Campaign name is required"],
      trim: true,
      maxlength: 120,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    referrerRewardPoints: {
      type: Number,
      required: true,
      default: 100,
      min: [0, "Referrer reward points cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Referrer reward points must be an integer",
      },
    },
    referredRewardPoints: {
      type: Number,
      required: true,
      default: 50,
      min: [0, "Referred reward points cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Referred reward points must be an integer",
      },
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    maxReferralsPerUser: {
      type: Number,
      default: 0, // 0 = unlimited
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: "Standard Registration-based Referral Campaign",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes
referralCampaignSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

const ReferralCampaign = mongoose.model(
  "ReferralCampaign",
  referralCampaignSchema
);

export default ReferralCampaign;

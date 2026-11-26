import mongoose from "mongoose";

const dispatchSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "DEFAULT_DISPATCH_CONFIG",
      index: true,
    },
    autoDispatchEnabled: {
      type: Boolean,
      default: true,
    },
    initialSearchRadiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 20,
    },
    expandedSearchRadiusKm: {
      type: Number,
      default: 15,
      min: 5,
      max: 30,
    },
    maxSearchRadiusKm: {
      type: Number,
      default: 30,
      min: 10,
      max: 50,
    },
    riderOfferTimeoutSeconds: {
      type: Number,
      default: 20, // Blinkit-style quick 20-second offer countdown
      min: 10,
      max: 120,
    },
    maxDispatchAttempts: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    retryDelaySeconds: {
      type: Number,
      default: 15,
      min: 5,
      max: 60,
    },
    maxActiveOrdersPerRider: {
      type: Number,
      default: 1,
      min: 1,
      max: 3,
    },
    dispatchReadyStatus: {
      type: String,
      enum: ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"],
      default: "READY_FOR_PICKUP",
    },
    // Multi-factor ranking weights (must sum to approx 1.0)
    scoringWeights: {
      distanceWeight: { type: Number, default: 0.4 },
      etaWeight: { type: Number, default: 0.25 },
      workloadWeight: { type: Number, default: 0.15 },
      locationFreshnessWeight: { type: Number, default: 0.1 },
      acceptanceRateWeight: { type: Number, default: 0.1 },
    },
    // Authoritative Delivery Partner Rate Card
    payoutRateCard: {
      baseDeliveryFee: { type: Number, default: 40 },
      perKmDistanceFee: { type: Number, default: 15 },
      heavyPackageFee: { type: Number, default: 20 },
      peakHourIncentive: { type: Number, default: 0 },
      targetIncentivePerOrder: { type: Number, default: 10 },
    },
    cityConfigs: [
      {
        city: { type: String, required: true },
        initialRadiusKm: { type: Number, default: 5 },
        maxRadiusKm: { type: Number, default: 25 },
        baseFee: { type: Number, default: 40 },
        perKmFee: { type: Number, default: 15 },
      },
    ],
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Singleton getter to fetch active configuration, creating default if not exists
 */
dispatchSettingsSchema.statics.getActiveConfig = async function () {
  let config = await this.findOne({ key: "DEFAULT_DISPATCH_CONFIG" });
  if (!config) {
    config = await this.create({ key: "DEFAULT_DISPATCH_CONFIG" });
  }
  return config;
};

const DispatchSettings =
  mongoose.models.DispatchSettings ||
  mongoose.model("DispatchSettings", dispatchSettingsSchema);

export default DispatchSettings;

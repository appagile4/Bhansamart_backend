import mongoose from "mongoose";

const platformPaymentConfigSchema = new mongoose.Schema(
  {
    configKey: {
      type: String,
      default: "GLOBAL_PLATFORM_CONFIG",
      unique: true,
      index: true,
    },
    // Superadmin bank account details displayed for direct bank transfers
    bankDetails: {
      bankName: { type: String, default: "Nepal Investment Mega Bank" },
      accountHolderName: { type: String, default: "BhansaMart Pvt. Ltd." },
      accountNumber: { type: String, default: "01901020003456" },
      branchName: { type: String, default: "Kathmandu Central" },
      ifscOrRoutingCode: { type: String, default: "NIMBNPKA" },
      qrCodeImageUrl: { type: String, default: "" },
      instructions: {
        type: String,
        default: "Transfer order amount and share transaction receipt reference during verification.",
      },
      isActive: { type: Boolean, default: true },
    },
    // Payment methods toggled for checkout display
    enabledPaymentMethods: [
      {
        methodKey: {
          type: String,
          enum: ["card", "esewa", "khalti", "cod", "bank_transfer"],
          required: true,
        },
        displayName: { type: String, required: true },
        isEnabled: { type: Boolean, default: true },
        minAmount: { type: Number, default: 0 },
        maxAmount: { type: Number, default: 100000 },
        instructions: { type: String, default: "" },
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

// Helper to get or create the singleton platform payment configuration
platformPaymentConfigSchema.statics.getGlobalConfig = async function () {
  let config = await this.findOne({ configKey: "GLOBAL_PLATFORM_CONFIG" });
  if (!config) {
    config = await this.create({
      configKey: "GLOBAL_PLATFORM_CONFIG",
      bankDetails: {
        bankName: "Nepal Investment Mega Bank",
        accountHolderName: "BhansaMart Logistics Pvt. Ltd.",
        accountNumber: "01901020003456",
        branchName: "Kathmandu Central",
        ifscOrRoutingCode: "NIMBNPKA",
        qrCodeImageUrl: "",
        instructions: "Transfer payment to this verified account and quote Order Number in remarks.",
        isActive: true,
      },
      enabledPaymentMethods: [
        {
          methodKey: "card",
          displayName: "Credit / Debit Card",
          isEnabled: true,
          minAmount: 10,
          maxAmount: 100000,
        },
        {
          methodKey: "esewa",
          displayName: "eSewa Mobile Wallet",
          isEnabled: true,
          minAmount: 10,
          maxAmount: 50000,
        },
        {
          methodKey: "khalti",
          displayName: "Khalti Digital Wallet",
          isEnabled: true,
          minAmount: 10,
          maxAmount: 50000,
        },
        {
          methodKey: "cod",
          displayName: "Cash on Delivery",
          isEnabled: true,
          minAmount: 0,
          maxAmount: 10000,
        },
        {
          methodKey: "bank_transfer",
          displayName: "Direct Bank Transfer",
          isEnabled: true,
          minAmount: 100,
          maxAmount: 500000,
        },
      ],
    });
  }
  return config;
};

const PlatformPaymentConfig =
  mongoose.models.PlatformPaymentConfig ||
  mongoose.model("PlatformPaymentConfig", platformPaymentConfigSchema);

export default PlatformPaymentConfig;

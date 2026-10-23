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
      upiId: { type: String, default: "bhansamart@nimbl" },
      qrCodeImageUrl: { type: String, default: "" },
      instructions: {
        type: String,
        default: "Transfer order amount and quote your Order Number in the payment reference/remarks.",
      },
      isActive: { type: Boolean, default: true },
    },
    // Payment methods & digital wallets toggled for customer checkout
    enabledPaymentMethods: [
      {
        methodKey: {
          type: String,
          enum: ["card", "esewa", "khalti", "cod", "bank_transfer", "upi", "wallet"],
          required: true,
        },
        displayName: { type: String, required: true },
        isEnabled: { type: Boolean, default: true },
        accountIdentifier: { type: String, default: "" },
        qrCodeImageUrl: { type: String, default: "" },
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
          methodKey: "cod",
          displayName: "Cash on Delivery (COD)",
          isEnabled: true,
          minAmount: 0,
          maxAmount: 10000,
          instructions: "Pay with cash or dynamic QR on delivery to rider.",
        },
        {
          methodKey: "esewa",
          displayName: "eSewa Mobile Wallet",
          isEnabled: true,
          accountIdentifier: "9801234567",
          minAmount: 10,
          maxAmount: 50000,
          instructions: "Pay instantly via your eSewa digital wallet balance or QR.",
        },
        {
          methodKey: "khalti",
          displayName: "Khalti Digital Wallet",
          isEnabled: true,
          accountIdentifier: "9801234567",
          minAmount: 10,
          maxAmount: 50000,
          instructions: "Pay securely with your linked Khalti wallet or Khalti MPIN.",
        },
        {
          methodKey: "upi",
          displayName: "Fonepay / UPI Direct QR",
          isEnabled: true,
          accountIdentifier: "bhansamart@nimbl",
          minAmount: 10,
          maxAmount: 100000,
          instructions: "Scan treasury merchant QR code with any mobile banking app.",
        },
        {
          methodKey: "wallet",
          displayName: "BhansaMart Wallet Balance",
          isEnabled: true,
          minAmount: 0,
          maxAmount: 50000,
          instructions: "Use your platform wallet credits and referral rewards.",
        },
        {
          methodKey: "card",
          displayName: "Credit / Debit Card",
          isEnabled: true,
          minAmount: 10,
          maxAmount: 100000,
          instructions: "Pay online via Visa, MasterCard or SCT debit cards.",
        },
        {
          methodKey: "bank_transfer",
          displayName: "Direct Bank Transfer (Manual Verification)",
          isEnabled: true,
          minAmount: 100,
          maxAmount: 500000,
          instructions: "Transfer to platform bank account and reference your Order Number.",
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

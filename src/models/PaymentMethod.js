import mongoose from "mongoose";

const paymentMethodSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ["card", "wallet", "netbanking"],
        message: "Payment method type must be card, wallet, or netbanking",
      },
      required: [true, "Payment method type is required"],
    },

    // Card Specific Fields
    cardHolderName: {
      type: String,
      trim: true,
      default: "",
    },
    cardNumber: {
      type: String,
      trim: true,
      default: "",
    },
    last4: {
      type: String,
      trim: true,
      default: "",
    },
    expiryDate: {
      type: String,
      trim: true,
      default: "",
    },
    cardType: {
      type: String,
      enum: ["Visa", "Mastercard", "American Express", "Discover", "Other"],
      default: "Visa",
    },
    nickname: {
      type: String,
      enum: ["Personal", "Business", "Other"],
      default: "Personal",
    },
    isDefault: {
      type: Boolean,
      default: false,
    },

    // Wallet Specific Fields (eSewa / Khalti)
    walletType: {
      type: String,
      enum: ["esewa", "khalti"],
      default: undefined,
    },
    accountIdentifier: {
      type: String,
      trim: true,
      default: "",
    },
    isLinked: {
      type: Boolean,
      default: true,
    },

    // Netbanking Specific Fields
    bankId: {
      type: String,
      trim: true,
      default: "",
    },
    bankName: {
      type: String,
      trim: true,
      default: "",
    },
    shortCode: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

paymentMethodSchema.index({ user: 1, type: 1 });
paymentMethodSchema.index({ user: 1, walletType: 1 });

const PaymentMethod = mongoose.model("PaymentMethod", paymentMethodSchema);

export default PaymentMethod;

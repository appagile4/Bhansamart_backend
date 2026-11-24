import mongoose from "mongoose";
import crypto from "node:crypto";

const customerOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      lowercase: true,
      trim: true,
      index: true,
    },
    otpHash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["login", "registration", "setup_password"],
      default: "login",
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    resendAvailableAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 1000), // 60 seconds cooldown
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // Automatically purged by MongoDB after expiry
    },
    registrationTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    registrationTokenExpiresAt: {
      type: Date,
      default: null,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Method to verify plaintext candidate OTP
customerOtpSchema.methods.verifyOTP = function (candidateOTP) {
  if (this.attempts >= this.maxAttempts) {
    return { valid: false, reason: "MAX_ATTEMPTS_EXCEEDED" };
  }
  if (this.expiresAt < new Date()) {
    return { valid: false, reason: "EXPIRED" };
  }

  const candidateHash = crypto
    .createHash("sha256")
    .update(candidateOTP.toString().trim())
    .digest("hex");

  if (candidateHash !== this.otpHash) {
    this.attempts += 1;
    return {
      valid: false,
      reason: "INVALID",
      remainingAttempts: Math.max(0, this.maxAttempts - this.attempts),
    };
  }

  return { valid: true };
};

const CustomerOtp = mongoose.model("CustomerOtp", customerOtpSchema);

export default CustomerOtp;

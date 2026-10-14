import mongoose from "mongoose";

const documentSubSchema = new mongoose.Schema(
  {
    documentNumber: { type: String, default: "" },
    frontUrl: { type: String, default: "" },
    backUrl: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "NOT_SUBMITTED",
        "PENDING_VERIFICATION",
        "UNDER_REVIEW",
        "VERIFIED",
        "REJECTED",
        "RESUBMISSION_REQUIRED",
        "EXPIRED",
      ],
      default: "NOT_SUBMITTED",
    },
    rejectionReason: { type: String, default: "" },
    reviewerComments: { type: String, default: "" },
    verifiedAt: { type: Date },
    expiryDate: { type: Date },
  },
  { _id: false }
);

const deliveryBoySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Mobile phone number is required"],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    profilePhoto: {
      url: { type: String, default: "" },
      publicId: { type: String, default: null },
    },
    currentAddress: {
      addressLine: { type: String, default: "" },
      city: { type: String, default: "Kathmandu" },
      state: { type: String, default: "Bagmati" },
      pincode: { type: String, default: "44600" },
    },
    serviceCity: {
      type: String,
      default: "Kathmandu",
      index: true,
    },
    serviceArea: {
      type: String,
      default: "Central Kathmandu",
    },
    emergencyContact: {
      name: { type: String, default: "" },
      relationship: { type: String, default: "" },
      phone: { type: String, default: "" },
    },

    // Vehicle details
    vehicleDetails: {
      vehicleType: {
        type: String,
        enum: ["Bicycle", "Electric Bike", "Motorcycle", "Scooter"],
        default: "Motorcycle",
      },
      registrationNumber: { type: String, default: "" },
      licenseNumber: { type: String, default: "" },
    },

    // Bank & Payout details
    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      bankName: { type: String, default: "" },
      upiId: { type: String, default: "" },
    },

    // Documents & verification
    documents: {
      panCard: { type: documentSubSchema, default: () => ({}) },
      aadhaarCard: { type: documentSubSchema, default: () => ({}) },
      drivingLicense: { type: documentSubSchema, default: () => ({}) },
      vehicleRc: { type: documentSubSchema, default: () => ({}) },
    },

    // Mandatory Security Deposit (₹1,000)
    securityDeposit: {
      requiredAmount: { type: Number, default: 1000 },
      paidAmount: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ["PENDING", "PAID", "REFUND_REQUESTED", "REFUNDED"],
        default: "PENDING",
        index: true,
      },
      paidAt: { type: Date },
      transactionId: { type: String, default: "" },
      gateway: { type: String, default: "eSewa" },
    },

    // Admin Onboarding & Verification Status
    approvalStatus: {
      type: String,
      enum: [
        "PENDING_APPROVAL",
        "APPROVED",
        "REJECTED",
        "SUSPENDED",
        "DEACTIVATED",
      ],
      default: "PENDING_APPROVAL",
      index: true,
    },
    adminRemarks: { type: String, default: "" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },

    // Real-Time Availability & Location
    availability: {
      type: String,
      enum: ["OFFLINE", "ONLINE", "BUSY"],
      default: "OFFLINE",
      index: true,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [85.3240, 27.7172], // Kathmandu central coords
      },
    },
    lastLocationUpdatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Active Fulfillment
    activeOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },

    // Performance Metrics
    metrics: {
      totalDeliveries: { type: Number, default: 0 },
      rating: { type: Number, default: 5.0 },
      ratingsCount: { type: Number, default: 0 },
      acceptanceRate: { type: Number, default: 100 },
    },

    // Wallet balance (Only for delivery earnings, separate from security deposit)
    wallet: {
      currentBalance: { type: Number, default: 0 },
      totalEarned: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// 2dsphere index for geospatial nearest partner queries
deliveryBoySchema.index({ currentLocation: "2dsphere" });
deliveryBoySchema.index({ availability: 1, approvalStatus: 1 });

// Helper to mask sensitive strings
export const maskSensitiveString = (str, type) => {
  if (!str) return "";
  const cleaned = String(str).trim();
  if (type === "aadhaar") {
    if (cleaned.length >= 4) {
      return "********" + cleaned.slice(-4);
    }
    return "********";
  }
  if (type === "pan") {
    if (cleaned.length >= 10) {
      return cleaned.slice(0, 5) + "****" + cleaned.slice(-1);
    }
    return "****";
  }
  if (type === "bank") {
    if (cleaned.length >= 4) {
      return "******" + cleaned.slice(-4);
    }
    return "******";
  }
  return cleaned;
};

// Instance method to get masked safe profile
deliveryBoySchema.methods.getMaskedProfile = function () {
  const obj = this.toObject();

  if (obj.bankDetails?.accountNumber) {
    obj.bankDetails.accountNumber = maskSensitiveString(
      obj.bankDetails.accountNumber,
      "bank"
    );
  }

  if (obj.documents) {
    if (obj.documents.aadhaarCard?.documentNumber) {
      obj.documents.aadhaarCard.documentNumber = maskSensitiveString(
        obj.documents.aadhaarCard.documentNumber,
        "aadhaar"
      );
    }
    if (obj.documents.panCard?.documentNumber) {
      obj.documents.panCard.documentNumber = maskSensitiveString(
        obj.documents.panCard.documentNumber,
        "pan"
      );
    }
  }

  return obj;
};

// Check if all 4 required documents are verified
deliveryBoySchema.methods.areAllDocumentsVerified = function () {
  const docs = this.documents;
  return (
    docs?.panCard?.status === "VERIFIED" &&
    docs?.aadhaarCard?.status === "VERIFIED" &&
    docs?.drivingLicense?.status === "VERIFIED" &&
    docs?.vehicleRc?.status === "VERIFIED"
  );
};

// Check if partner is fully eligible to go ONLINE
deliveryBoySchema.methods.canGoOnline = function () {
  return (
    this.approvalStatus === "APPROVED" &&
    this.securityDeposit?.status === "PAID" &&
    this.areAllDocumentsVerified()
  );
};

const DeliveryBoy =
  mongoose.models.DeliveryBoy ||
  mongoose.model("DeliveryBoy", deliveryBoySchema);

export default DeliveryBoy;

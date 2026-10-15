import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      unique: true,
      index: true,
    },

    businessDetails: {
      businessName: { type: String, default: "" },
      businessType: { type: String, default: "" },
      gstNumber: { type: String, default: "" },
      panNumber: { type: String, default: "" },
      businessEmail: { type: String, default: "" },
      businessPhone: { type: String, default: "" },
      yearEstablished: { type: Number, default: null },
      numberOfEmployees: { type: Number, default: null },
      categories: [{ type: String }],
      retailChannel: { type: String, default: "Online" },
      onboardingType: [{ type: String }],
    },

    sellerDetails: {
      sellerName: { type: String, default: "" },
      sellerEmail: { type: String, default: "" },
      sellerPhone: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },

    brandDetails: {
      brandName: { type: String, default: "" },
      brandType: { type: String, default: "" },
      trademarkNumber: { type: String, default: "" },
      brandWebsite: { type: String, default: "" },
      brandLogo: { type: String, default: "" },
      brandLogoPublicId: { type: String, default: null },
    },

    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      bankName: { type: String, default: "" },
      branch: { type: String, default: "" },
    },

    shippingLocations: {
      warehouseAddress: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    kycDetails: {
      avatarUrl: { type: String, default: null },
      avatarPublicId: { type: String, default: null },
      documents: {
        aadhaar: { type: String, default: null },
        drivingLicence: { type: String, default: null },
      },
      documentPublicIds: {
        aadhaar: { type: String, default: null },
        drivingLicence: { type: String, default: null },
      },
    },

    digitalSignature: {
      signed: { type: Boolean, default: false },
      signatureDate: { type: Date, default: null },
    },

    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "active"],
      default: "active",
    },

    // Vendor Financial Ledger & Custody Wallet
    wallet: {
      currentBalance: { type: Number, default: 0, min: 0 }, // Eligible withdrawable balance
      totalEarned: { type: Number, default: 0, min: 0 },
      pendingSettlement: { type: Number, default: 0, min: 0 },
      codCashWithDeliveryBoys: { type: Number, default: 0, min: 0 }, // Cash in delivery boys custody
    },

    // Vendor Configured Payment QR Code & UPI Details
    paymentSettings: {
      qrCodeUrl: { type: String, default: "" },
      qrCodePublicId: { type: String, default: null },
      upiId: { type: String, default: "" },
      accountName: { type: String, default: "" },
      acceptQrPayments: { type: Boolean, default: false },
    },

    // Vendor Delivery Radius & Store Operational Status
    deliveryRadiusKm: {
      type: Number,
      default: 5,
      min: 1,
      max: 50,
      index: true,
    },
    isStoreOpen: {
      type: Boolean,
      default: true,
      index: true,
    },

    // GeoJSON Point for geospatial radius matching
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [85.3240, 27.7172], // Central Kathmandu default
      },
    },

    adminRemark: { type: String, default: "" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// 2dsphere index for customer proximity & radius matching
vendorSchema.index({ location: "2dsphere" });
vendorSchema.index({ status: 1, isStoreOpen: 1 });

// Ensure GeoJSON location stays synchronized with shipping warehouse coordinates
vendorSchema.pre("save", function () {
  if (
    this.shippingLocations?.longitude != null &&
    this.shippingLocations?.latitude != null &&
    !isNaN(this.shippingLocations.longitude) &&
    !isNaN(this.shippingLocations.latitude)
  ) {
    this.location = {
      type: "Point",
      coordinates: [
        Number(this.shippingLocations.longitude),
        Number(this.shippingLocations.latitude),
      ],
    };
  }
});

const Vendor = mongoose.model("Vendor", vendorSchema);

export default Vendor;

import mongoose from "mongoose";

const refundItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    imageUrl: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    refundNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    claimType: {
      type: String,
      enum: [
        "CANCELLATION",
        "CANCEL_PRE_DISPATCH",
        "RETURN",
        "REFUND",
        "RETURN_REFUND",
        "REPLACEMENT",
        "EXCHANGE",
        "DEFECTIVE",
        "DEFECTIVE_CLAIM",
        "WRONG_ITEM",
      ],
      default: "CANCELLATION",
      index: true,
    },
    items: [refundItemSchema],
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPaymentMethod: {
      type: String,
      default: "Cash on delivery",
    },
    vendorDeduction: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionReversal: {
      type: Number,
      default: 0,
      min: 0,
    },
    commissionRate: {
      type: Number,
      default: 0.015,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    proofImages: [{ type: String }],
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "APPROVED",
        "PROCESSING",
        "COMPLETED",
        "REJECTED",
        "FAILED",
        "VENDOR_REVIEW",
        "VENDOR_ACCEPTED",
        "VENDOR_REJECTED",
        "VENDOR_INFO_REQUIRED",
        "STAFF_EXAMINING",
        "FORWARDED_TO_FINANCE",
        "RETURN_PICKUP_SCHEDULED",
        "RETURN_PICKED_UP",
        "RETURN_RECEIVED",
        "INSPECTED_PASSED",
        "INSPECTED_FAILED",
        "VENDOR_PAID",
      ],
      default: "REQUESTED",
      index: true,
    },
    // Indicates if this refund is funded directly by the vendor (e.g. for COD orders)
    isVendorFunded: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Vendor Direct Payment Confirmation for COD Refunds
    vendorPaymentDetails: {
      paymentMethod: {
        type: String,
        enum: ["UPI", "BANK_TRANSFER", "CASH", "DIRECT_STORE_PAYOUT"],
        default: "UPI",
      },
      transactionReference: { type: String, default: "" },
      proofImage: { type: String, default: "" },
      paidAt: { type: Date, default: null },
      confirmedByVendor: { type: Boolean, default: false },
      notes: { type: String, default: "" },
    },
    // Vendor Initial Review
    vendorReview: {
      decision: {
        type: String,
        enum: ["PENDING", "ACCEPTED", "REJECTED", "INFO_REQUIRED"],
        default: "PENDING",
      },
      notes: { type: String, default: "" },
      respondedAt: { type: Date, default: null },
      proofImages: [{ type: String }],
    },
    // StaffAdmin Operational Examination
    staffReview: {
      reviewer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      reviewerName: { type: String, default: "" },
      notes: { type: String, default: "" },
      isExamined: { type: Boolean, default: false },
      examinedAt: { type: Date, default: null },
      forwardedToFinance: { type: Boolean, default: false },
      forwardedAt: { type: Date, default: null },
    },
    // Reverse Return Pickup
    pickup: {
      required: { type: Boolean, default: false },
      deliveryBoy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
        default: null,
      },
      otp: { type: String, default: "" },
      otpExpiresAt: { type: Date, default: null },
      isOtpVerified: { type: Boolean, default: false },
      status: {
        type: String,
        enum: [
          "NOT_REQUIRED",
          "PENDING_ASSIGNMENT",
          "ASSIGNED",
          "OUT_FOR_PICKUP",
          "PICKED_UP",
          "RECEIVED_AT_VENDOR",
          "FAILED",
        ],
        default: "NOT_REQUIRED",
      },
      scheduledAt: { type: Date, default: null },
      pickedUpAt: { type: Date, default: null },
      receivedAt: { type: Date, default: null },
      failureReason: { type: String, default: "" },
      notes: { type: String, default: "" },
      pickupCharge: { type: Number, default: 50 },
      isPickupChargeDebited: { type: Boolean, default: false },
      isDeliveryBoyPaid: { type: Boolean, default: false },
      pickupChargeTxRef: { type: String, default: "" },
    },
    // Item Inspection
    inspection: {
      required: { type: Boolean, default: false },
      result: {
        type: String,
        enum: ["NOT_REQUIRED", "PENDING", "PASSED", "FAILED"],
        default: "NOT_REQUIRED",
      },
      condition: {
        type: String,
        enum: ["", "INTACT", "DAMAGED", "OPEN_BOX", "DEFECTIVE", "WRONG_ITEM", "MISSING_PARTS"],
        default: "",
      },
      missingAccessories: { type: String, default: "" },
      visibleDamage: { type: String, default: "" },
      quantityCollected: { type: Number, default: 0 },
      location: { type: String, default: "" },
      inspectedByBoy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
        default: null,
      },
      notes: { type: String, default: "" },
      inspectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      inspectedAt: { type: Date, default: null },
      proofImages: [{ type: String }],
    },
    // Exchange or Replacement Details
    exchangeDetails: {
      exchangeProductId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        default: null,
      },
      exchangeProductName: { type: String, default: "" },
      priceDifference: { type: Number, default: 0 },
      fulfillmentStatus: {
        type: String,
        enum: ["NONE", "PENDING", "DISPATCHED", "DELIVERED"],
        default: "NONE",
      },
      replacementOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        default: null,
      },
    },
    // Audit Timeline
    timeline: [
      {
        status: { type: String, required: true },
        actorRole: { type: String, default: "system" },
        actorName: { type: String, default: "" },
        notes: { type: String, default: "" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    gatewayRefundId: {
      type: String,
      default: "",
    },
    customerPayoutDetails: {
      method: {
        type: String,
        enum: ["GATEWAY_REVERSAL", "UPI", "BANK_TRANSFER", "WALLET", "NONE"],
        default: "GATEWAY_REVERSAL",
      },
      upiId: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      payoutReference: { type: String, default: "" },
      payoutProofImage: { type: String, default: "" },
      payoutCompletedAt: { type: Date, default: null },
      processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      processedByRole: { type: String, default: "" },
    },
    replacementOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminNotes: {
      type: String,
      default: "",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast lookup
refundSchema.index({ customer: 1, createdAt: -1 });
refundSchema.index({ vendor: 1, createdAt: -1 });
refundSchema.index({ order: 1, status: 1 });

// Helper to generate human-readable refund number
refundSchema.statics.generateRefundNumber = async function () {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const random = Math.floor(1000 + Math.random() * 9000);
  let refundNumber = `REF-${dateStr}-${random}`;

  let exists = await this.findOne({ refundNumber });
  while (exists) {
    const newRandom = Math.floor(1000 + Math.random() * 9000);
    refundNumber = `REF-${dateStr}-${newRandom}`;
    exists = await this.findOne({ refundNumber });
  }

  return refundNumber;
};

/**
 * Mask sensitive customer payout information (banking / UPI) for safe display in portals
 */
export const maskCustomerPayoutDetails = (payoutDetails) => {
  if (!payoutDetails) return {};
  const details = { ...payoutDetails };

  if (details.accountNumber && typeof details.accountNumber === "string") {
    const clean = details.accountNumber.trim();
    if (clean.length > 4) {
      details.accountNumber = "********" + clean.slice(-4);
    } else {
      details.accountNumber = "********";
    }
  }

  if (details.upiId && typeof details.upiId === "string") {
    const parts = details.upiId.split("@");
    if (parts.length === 2 && parts[0].length > 3) {
      details.upiId = `${parts[0].slice(0, 2)}***${parts[0].slice(-1)}@${parts[1]}`;
    }
  }

  if (details.ifscCode && typeof details.ifscCode === "string") {
    const clean = details.ifscCode.trim();
    if (clean.length > 4) {
      details.ifscCode = clean.slice(0, 4) + "****" + clean.slice(-2);
    } else {
      details.ifscCode = "****";
    }
  }

  return details;
};

refundSchema.statics.maskCustomerPayoutDetails = maskCustomerPayoutDetails;

const Refund = mongoose.models.Refund || mongoose.model("Refund", refundSchema);

export default Refund;

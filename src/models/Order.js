import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
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
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    originalPrice: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    imageUrl: {
      type: String,
      default: "",
    },
    weight: {
      type: String,
      default: "",
    },
    isReturnable: {
      type: Boolean,
      default: false,
    },
    returnWindowDays: {
      type: Number,
      default: 7,
    },
    isReplaceable: {
      type: Boolean,
      default: false,
    },
    isRefundable: {
      type: Boolean,
      default: false,
    },
    category: {
      type: String,
      default: "",
    },
  },
  { _id: true }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    reason: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
  {
    addressLine: { type: String, required: true },
    city: { type: String, default: "Kathmandu" },
    street: { type: String, default: "" },
    houseNo: { type: String, default: "" },
    landmark: { type: String, default: "" },
    phone: { type: String, required: true },
    type: { type: String, default: "Home" },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
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
    items: [orderItemSchema],
    totalCount: {
      type: Number,
      required: true,
      min: 1,
    },
    itemsTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    handlingCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    couponCode: {
      type: String,
      default: "",
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    deliveryAddress: {
      type: deliveryAddressSchema,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: [
        "Cash on delivery",
        "esewa",
        "khalti",
        "card",
        "Vendor QR Code (Direct)",
        "Online Payment",
        "Replacement (No Charge)",
      ],
      default: "Cash on delivery",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partially_refunded"],
      default: "pending",
      index: true,
    },
    paymentDetails: {
      gatewayTransactionId: { type: String, default: "" },
      paymentProvider: { type: String, default: "" },
      verifiedAt: { type: Date, default: null },
      rawGatewayResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    financialLedger: {
      eligibleAmount: { type: Number, default: 0 },
      commissionRate: { type: Number, default: 0.015 },
      commissionAmount: { type: Number, default: 0 },
      vendorNetAmount: { type: Number, default: 0 },
      settlementStatus: {
        type: String,
        enum: [
          "PENDING",
          "SETTLED",
          "REVERSED",
          "REFUNDED",
          "PARTIALLY_REFUNDED",
          "COD_IN_CUSTODY",
          "COD_SUBMITTED",
        ],
        default: "PENDING",
      },
      settledAt: { type: Date, default: null },
    },
    refundStatus: {
      type: String,
      enum: [
        "NONE",
        "NOT_APPLICABLE",
        "REQUESTED",
        "APPROVED",
        "PARTIAL_REFUNDED",
        "REFUNDED",
        "REPLACED",
        "REJECTED",
      ],
      default: "NONE",
      index: true,
    },
    orderStatus: {
      type: String,
      enum: [
        "PLACED",
        "ACCEPTED",
        "PREPARING",
        "READY_FOR_PICKUP",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "CANCELLED",
        "REJECTED",
      ],
      default: "PLACED",
      index: true,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    deliveryCancellationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    cancellationDetails: [
      {
        cancelledBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DeliveryBoy",
        },
        reason: { type: String, default: "" },
        notes: { type: String, default: "" },
        cancelledAt: { type: Date, default: Date.now },
        returnedToVendor: { type: Boolean, default: true },
      },
    ],
    statusHistory: [statusHistorySchema],
    estimatedDeliveryTime: {
      type: String,
      default: "15-25 mins",
    },
    deliveredAt: {
      type: Date,
    },
    acceptedAt: {
      type: Date,
    },
    // Delivery Boy tracking & verification
    assignedDeliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      default: null,
      index: true,
    },
    pickupOtp: {
      code: { type: String, select: false }, // Hashed pickup OTP
      displayCode: { type: String, default: "" }, // Store for vendor presentation
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      verifiedAt: { type: Date },
    },
    deliveryOtp: {
      code: { type: String, select: false }, // Hashed customer delivery OTP
      displayCode: { type: String, default: "" }, // Store for customer presentation
      expiresAt: { type: Date },
      attempts: { type: Number, default: 0 },
      verifiedAt: { type: Date },
    },
    arrivedAtStoreAt: {
      type: Date,
    },
    pickedUpAt: {
      type: Date,
    },
    arrivedAtCustomerAt: {
      type: Date,
    },
    deliveryBoyLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [85.3240, 27.7172],
      },
      updatedAt: {
        type: Date,
      },
    },
    deliveryEarnings: {
      basePay: { type: Number, default: 40 },
      distancePay: { type: Number, default: 20 },
      tip: { type: Number, default: 0 },
      total: { type: Number, default: 60 },
    },
    // COD Collection and Custody Tracking
    codDetails: {
      cashCollectedByRider: { type: Boolean, default: false },
      cashCollectedAmount: { type: Number, default: 0 },
      cashCollectedAt: { type: Date, default: null },
      cashSubmittedToVendor: { type: Boolean, default: false },
      cashSubmittedAt: { type: Date, default: null },
      handoverReceipt: { type: String, default: "" },
      isDirectVendorQrPaid: { type: Boolean, default: false },
      directQrPaidAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for fast queries
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ vendor: 1, orderStatus: 1, createdAt: -1 });

// Static helper to generate unique human-readable order number
orderSchema.statics.generateOrderNumber = async function () {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  let orderNumber = `BM-${dateStr}-${randomPart}`;

  // Ensure uniqueness
  let exists = await this.findOne({ orderNumber });
  while (exists) {
    const newRandom = Math.floor(1000 + Math.random() * 9000);
    orderNumber = `BM-${dateStr}-${newRandom}`;
    exists = await this.findOne({ orderNumber });
  }

  return orderNumber;
};

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

export default Order;

import mongoose from "mongoose";

const deliveryAssignmentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      required: false,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "OFFERED",
        "ACCEPTED",
        "REJECTED",
        "TIMED_OUT",
        "CANCELLED",
        "COMPLETED",
        "UNASSIGNED_ESCALATED",
      ],
      default: "OFFERED",
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 1,
    },
    maxRetries: {
      type: Number,
      default: 5,
    },
    attempts: [
      {
        deliveryBoy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DeliveryBoy",
        },
        offeredAt: { type: Date, default: Date.now },
        respondedAt: { type: Date },
        status: {
          type: String,
          enum: ["OFFERED", "ACCEPTED", "REJECTED", "TIMED_OUT", "SKIPPED"],
        },
        reason: { type: String, default: "" },
        distanceKm: { type: Number, default: 0 },
        searchTier: {
          type: String,
          enum: ["PRIORITY_1", "PRIORITY_2_EXPANDED", "PRIORITY_3_MAX"],
          default: "PRIORITY_1",
        },
      },
    ],
    notifiedRiders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
      },
    ],
    declinedRiders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
      },
    ],
    timedOutRiders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "DeliveryBoy",
      },
    ],
    failureReason: {
      type: String,
      default: "",
    },
    nextRetryAt: {
      type: Date,
    },
    offeredAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: false,
      index: true,
    },
    acceptedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    completedAt: {
      type: Date,
    },
    estimatedEarnings: {
      type: Number,
      default: 60,
    },
    distanceKm: {
      type: Number,
      default: 2.0,
    },
    pickupLocation: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [85.3240, 27.7172],
      },
    },
    deliveryLocation: {
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [85.3240, 27.7172],
      },
    },
  },
  {
    timestamps: true,
  }
);

deliveryAssignmentSchema.index({ deliveryBoy: 1, status: 1 });
deliveryAssignmentSchema.index({ order: 1, status: 1 });
deliveryAssignmentSchema.index({ order: 1, vendor: 1 });
deliveryAssignmentSchema.index({ order: 1, createdAt: -1 });

const DeliveryAssignment =
  mongoose.models.DeliveryAssignment ||
  mongoose.model("DeliveryAssignment", deliveryAssignmentSchema);

export default DeliveryAssignment;

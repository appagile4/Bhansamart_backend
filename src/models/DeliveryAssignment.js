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
      required: true,
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
      ],
      default: "OFFERED",
      index: true,
    },
    offeredAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
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

const DeliveryAssignment =
  mongoose.models.DeliveryAssignment ||
  mongoose.model("DeliveryAssignment", deliveryAssignmentSchema);

export default DeliveryAssignment;

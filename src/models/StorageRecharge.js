import mongoose from "mongoose";

/**
 * Vendor storage recharge requests (NEW collection: "storagerecharges").
 * Today: mock payment → PENDING → super admin APPROVES/REJECTS.
 * Later: a real gateway can mark it PAID and approval becomes optional (see utils/payments).
 */
const storageRechargeSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    planId: { type: String, required: true },
    planName: { type: String, required: true },
    extraBytes: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NPR" },
    paymentProvider: { type: String, default: "mock" },
    paymentRef: { type: String, default: "", trim: true },
    vendorNote: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["PENDING", "PAID", "APPROVED", "REJECTED"], default: "PENDING" },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    adminNote: { type: String, default: "", trim: true, maxlength: 500 },
    quotaBefore: { type: Number, default: null },
    quotaAfter: { type: Number, default: null },
  },
  { timestamps: true }
);

storageRechargeSchema.index({ status: 1, createdAt: -1 });
storageRechargeSchema.index({ vendor: 1, createdAt: -1 });

const StorageRecharge = mongoose.model("StorageRecharge", storageRechargeSchema);
export default StorageRecharge;

import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorName: {
      type: String,
      default: "",
    },
    actorEmail: {
      type: String,
      default: "",
    },
    actorRole: {
      type: String,
      enum: ["superadmin", "admin", "system"],
      default: "admin",
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true, // e.g. CREATE_ADMIN, UPDATE_VENDOR_STATUS, APPROVE_WITHDRAWAL, REJECT_WITHDRAWAL, MODERATE_PRODUCT
    },
    targetResource: {
      type: String,
      required: true,
      index: true, // e.g. Vendor, User, Product, Category, Withdrawal, PaymentConfig, Ticket
    },
    targetId: {
      type: String,
      default: "",
      index: true,
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    details: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Immutable append-only audit trail
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetResource: 1, targetId: 1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;

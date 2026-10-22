import mongoose from "mongoose";

const ticketMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["customer", "vendor", "delivery_boy", "admin", "superadmin"],
      required: true,
    },
    message: {
      type: String,
      required: [true, "Message text is required"],
      trim: true,
    },
    attachments: [{ type: String }],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      index: true,
    },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userRole: {
      type: String,
      enum: ["customer", "vendor", "delivery_boy", "admin"],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "product",
        "order",
        "delivery",
        "account",
        "refund_return",
        "payment",
        "withdrawal",
        "technical",
        "other",
      ],
      default: "order",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },
    subject: {
      type: String,
      required: [true, "Ticket subject is required"],
      trim: true,
      maxlength: [200, "Subject cannot exceed 200 characters"],
    },
    description: {
      type: String,
      required: [true, "Ticket description is required"],
      trim: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DeliveryBoy",
      default: null,
      index: true,
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    attachments: [{ type: String }],
    messages: [ticketMessageSchema],
    resolutionNotes: {
      type: String,
      default: "",
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Helper to generate human-readable unique ticket number
ticketSchema.statics.generateTicketNumber = async function () {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const random = Math.floor(1000 + Math.random() * 9000);
  let ticketNumber = `TCK-${dateStr}-${random}`;

  let exists = await this.findOne({ ticketNumber });
  while (exists) {
    const newRandom = Math.floor(1000 + Math.random() * 9000);
    ticketNumber = `TCK-${dateStr}-${newRandom}`;
    exists = await this.findOne({ ticketNumber });
  }

  return ticketNumber;
};

// Indexes
ticketSchema.index({ vendor: 1, status: 1 });
ticketSchema.index({ assignedAdmin: 1, status: 1 });
ticketSchema.index({ raisedBy: 1, createdAt: -1 });

const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);

export default Ticket;

import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Address must belong to a user"],
      index: true,
    },
    type: {
      type: String,
      enum: {
        values: ["Home", "Work", "Other"],
        message: "Address type must be Home, Work, or Other",
      },
      default: "Home",
    },
    addressLine: {
      type: String,
      required: [true, "Address line is required"],
      trim: true,
    },
    houseNo: {
      type: String,
      trim: true,
      default: "",
    },
    street: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "Kathmandu",
    },
    landmark: {
      type: String,
      trim: true,
      default: "",
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Index for fast query of user addresses
addressSchema.index({ user: 1, createdAt: -1 });

const Address = mongoose.models.Address || mongoose.model("Address", addressSchema);

export default Address;

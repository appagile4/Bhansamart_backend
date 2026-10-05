import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "Please provide a valid email address",
      ],
      index: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters long"],
      select: false, // Never return password in queries by default
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    avatar: {
      type: String,
      default: "",
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: {
        values: ["Male", "Female", "Other", "Prefer not to say", ""],
        message: "Gender must be Male, Female, Other, or Prefer not to say",
      },
      default: "Prefer not to say",
    },
    role: {
      type: String,
      enum: ["customer", "user", "vendor", "admin", "superadmin"],
      default: "customer",
      index: true,
    },

    // Vendor / Delivery specific status
    status: {
      type: String,
      enum: ["pending", "approved", "active", "suspended"],
      default: "active",
    },
    isApproved: {
      type: Boolean,
      default: function () {
        return this.role === "customer" || this.role === "user";
      },
    },

    // OTP for Login / Verification
    otp: {
      type: String,
      select: false,
    },
    otpExpires: {
      type: Date,
      select: false,
    },

    // Email verification fields
    isEmailVerified: {
      type: Boolean,
      default: true,
    },
    emailVerificationOTP: {
      type: String,
      select: false,
    },
    emailVerificationOTPExpires: {
      type: Date,
      select: false,
    },
    lastVerificationEmailSentAt: {
      type: Date,
      select: false,
    },

    // Password reset fields
    resetPasswordOTP: {
      type: String,
      select: false,
    },
    resetPasswordOTPExpires: {
      type: Date,
      select: false,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordTokenExpires: {
      type: Date,
      select: false,
    },

    // Security & state fields
    passwordChangedAt: {
      type: Date,
    },
    lastLoginAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.otp;
        delete ret.otpExpires;
        delete ret.emailVerificationOTP;
        delete ret.emailVerificationOTPExpires;
        delete ret.lastVerificationEmailSentAt;
        delete ret.resetPasswordOTP;
        delete ret.resetPasswordOTPExpires;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordTokenExpires;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.otp;
        delete ret.otpExpires;
        delete ret.emailVerificationOTP;
        delete ret.emailVerificationOTPExpires;
        delete ret.lastVerificationEmailSentAt;
        delete ret.resetPasswordOTP;
        delete ret.resetPasswordOTPExpires;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordTokenExpires;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Hash password before saving if modified
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare plaintext candidate password with hashed password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if password was changed after a JWT token was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

const User = mongoose.model("User", userSchema);

export default User;

import crypto from "node:crypto";
import User from "../models/User.js";
import CustomerOtp from "../models/CustomerOtp.js";
import { generateOTP, hashData } from "../utils/generateOTP.js";
import { generateAccessToken } from "../utils/generateToken.js";
import { sendCustomerAuthOTP } from "../utils/sendEmail.js";
import { verifyGoogleIdToken } from "../utils/verifyGoogleToken.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  generateUniqueReferralCode,
  validateReferralCode,
  createReferralAttribution,
  processReferralReward,
} from "../services/referralService.js";

// Helper to sanitize customer user object for API responses
const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name || "Customer",
  email: user.email,
  phone: user.phone || "",
  avatar: user.avatar || "",
  address: user.address || "",
  dateOfBirth: user.dateOfBirth || null,
  gender: user.gender || "Prefer not to say",
  role: user.role,
  referralCode: user.referralCode || "",
  rewardPoints: user.rewardPoints || 0,
  isEmailVerified: Boolean(user.isEmailVerified),
  authProvider: user.authProvider || "local",
});

/**
 * @desc    Check customer email existence & available login options
 * @route   POST /api/customer/auth/check-email
 * @access  Public
 */
export const checkEmail = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return next(new AppError("Please provide a valid email address.", 400));
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (user) {
      if (user.role === "vendor") {
        return res.status(403).json({
          success: false,
          message:
            "This email is registered as a Vendor account. Please log in through the Vendor Portal.",
          isVendor: true,
        });
      }

      if (user.role === "delivery_boy") {
        return res.status(403).json({
          success: false,
          message:
            "This email is registered as a Delivery Partner. Please log in through the Delivery App.",
          isDeliveryBoy: true,
        });
      }

      const hasPassword = Boolean(user.password && user.password.length > 0);
      const authOptions = ["otp", "google"];
      if (hasPassword) authOptions.unshift("password");

      return res.status(200).json({
        success: true,
        data: {
          exists: true,
          hasPassword,
          isCustomer: user.role === "customer" || user.role === "user",
          authProvider: user.authProvider || (hasPassword ? "local" : "google"),
          authenticationOptions: authOptions,
        },
      });
    }

    // New Customer
    return res.status(200).json({
      success: true,
      data: {
        exists: false,
        hasPassword: false,
        isCustomer: true,
        authProvider: "new",
        authenticationOptions: ["otp", "google"],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send Email OTP for Login or Registration
 * @route   POST /api/customer/auth/send-otp
 * @access  Public
 */
export const sendOtp = async (req, res, next) => {
  try {
    const { email, purpose } = req.body;
    if (!email || typeof email !== "string") {
      return next(new AppError("Please provide a valid email address.", 400));
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      if (existingUser.role === "vendor") {
        return next(
          new AppError(
            "This email is registered as a Vendor. Please log in through the Vendor Portal.",
            403
          )
        );
      }
      if (existingUser.role === "delivery_boy") {
        return next(
          new AppError(
            "This email is registered as a Delivery Partner. Please log in through the Delivery App.",
            403
          )
        );
      }
      if (!existingUser.isActive) {
        return next(
          new AppError(
            "Your account has been deactivated. Please contact customer support.",
            403
          )
        );
      }
    }

    const resolvedPurpose = existingUser ? "login" : "registration";

    // Rate Limiting / Resend Cooldown Check
    const recentOtp = await CustomerOtp.findOne({
      email: normalizedEmail,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (recentOtp && recentOtp.resendAvailableAt > new Date()) {
      const remainingSeconds = Math.ceil(
        (recentOtp.resendAvailableAt.getTime() - Date.now()) / 1000
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
        resendCooldown: remainingSeconds,
      });
    }

    // Generate cryptographically secure 6-digit OTP
    const otp = generateOTP();
    const otpHash = hashData(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
    const resendAvailableAt = new Date(Date.now() + 60 * 1000); // 60 seconds cooldown

    // Upsert OTP record
    await CustomerOtp.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        otpHash,
        purpose: resolvedPurpose,
        attempts: 0,
        maxAttempts: 5,
        resendAvailableAt,
        expiresAt,
        registrationTokenHash: null,
        registrationTokenExpiresAt: null,
        isVerified: false,
        verifiedAt: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Send styled BhansaMart email
    await sendCustomerAuthOTP(normalizedEmail, otp, resolvedPurpose);

    res.status(200).json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
      data: {
        email: normalizedEmail,
        purpose: resolvedPurpose,
        isNewCustomer: !existingUser,
        resendCooldown: 60,
        expiresIn: 600,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify Email OTP (Direct Login for Existing, Token for New)
 * @route   POST /api/customer/auth/verify-otp
 * @access  Public
 */
export const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return next(new AppError("Email and 6-digit OTP are required.", 400));
    }

    const normalizedEmail = email.toLowerCase().trim();
    const candidateOTP = otp.toString().trim();

    // Find active OTP record
    const otpDoc = await CustomerOtp.findOne({
      email: normalizedEmail,
      expiresAt: { $gt: new Date() },
    });

    if (!otpDoc) {
      return next(
        new AppError(
          "Verification code has expired or does not exist. Please request a new code.",
          400
        )
      );
    }

    // Verify OTP using schema method
    const verification = otpDoc.verifyOTP(candidateOTP);

    if (!verification.valid) {
      if (verification.reason === "MAX_ATTEMPTS_EXCEEDED") {
        await CustomerOtp.deleteOne({ _id: otpDoc._id });
        return next(
          new AppError(
            "Too many incorrect attempts. Please request a new verification code.",
            429
          )
        );
      }
      if (verification.reason === "EXPIRED") {
        return next(
          new AppError(
            "Verification code has expired. Please request a new code.",
            400
          )
        );
      }
      // Invalid OTP
      await otpDoc.save();
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. ${verification.remainingAttempts} attempts remaining.`,
        remainingAttempts: verification.remainingAttempts,
      });
    }

    // OTP is valid
    otpDoc.isVerified = true;
    otpDoc.verifiedAt = new Date();

    // Check if customer exists
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      // ── EXISTING CUSTOMER: DIRECT LOGIN ──
      if (!existingUser.isActive) {
        return next(
          new AppError("Your account has been deactivated. Contact support.", 403)
        );
      }

      existingUser.lastLoginAt = new Date();
      existingUser.isEmailVerified = true;
      await existingUser.save({ validateBeforeSave: false });

      // Clean up used OTP
      await CustomerOtp.deleteOne({ _id: otpDoc._id });

      const token = generateAccessToken(existingUser);

      return res.status(200).json({
        success: true,
        verified: true,
        isNewCustomer: false,
        requiresPasswordSetup: false,
        message: "Login successful.",
        data: {
          token,
          user: sanitizeUser(existingUser),
        },
      });
    }

    // ── NEW CUSTOMER: GENERATE SINGLE-USE REGISTRATION TOKEN ──
    const rawRegistrationToken = crypto.randomBytes(32).toString("hex");
    otpDoc.registrationTokenHash = hashData(rawRegistrationToken);
    otpDoc.registrationTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins to set password
    await otpDoc.save();

    return res.status(200).json({
      success: true,
      verified: true,
      isNewCustomer: true,
      requiresPasswordSetup: true,
      message: "Email verified. Please set your password to complete registration.",
      data: {
        registrationToken: rawRegistrationToken,
        email: normalizedEmail,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Complete Registration with Password Setup for New Customer
 * @route   POST /api/customer/auth/complete-registration
 * @access  Public
 */
export const completeRegistration = async (req, res, next) => {
  try {
    const { registrationToken, password, confirmPassword, name, referralCode } =
      req.body;

    if (!registrationToken) {
      return next(
        new AppError(
          "Registration session token is missing. Please verify your email again.",
          400
        )
      );
    }

    if (!password || password.length < 6) {
      return next(
        new AppError("Password must be at least 6 characters long.", 400)
      );
    }

    if (confirmPassword && password !== confirmPassword) {
      return next(new AppError("Passwords do not match.", 400));
    }

    // Verify registration token against database
    const tokenHash = hashData(registrationToken.trim());
    const otpDoc = await CustomerOtp.findOne({
      registrationTokenHash: tokenHash,
      isVerified: true,
      registrationTokenExpiresAt: { $gt: new Date() },
    });

    if (!otpDoc) {
      return next(
        new AppError(
          "Invalid or expired registration session. Please verify your email again.",
          400
        )
      );
    }

    const email = otpDoc.email;

    // Prevent duplicate account creation
    const existing = await User.findOne({ email });
    if (existing) {
      await CustomerOtp.deleteOne({ _id: otpDoc._id });
      return next(
        new AppError("An account with this email already exists. Please log in.", 400)
      );
    }

    // Validate optional referral code
    let validatedReferrer = null;
    if (referralCode && typeof referralCode === "string" && referralCode.trim() !== "") {
      try {
        validatedReferrer = await validateReferralCode(referralCode.trim());
      } catch (refErr) {
        // Log warning but don't crash
        console.warn("[Referral validation warning]:", refErr.message);
      }
    }

    // Generate unique referral code for this new customer
    const newReferralCode = await generateUniqueReferralCode(name || "Customer");

    // Create the permanent customer account
    const user = await User.create({
      name: name && name.trim() ? name.trim() : "Customer",
      email,
      password, // Pre-save hook hashes with bcrypt
      role: "customer",
      isEmailVerified: true,
      authProvider: "otp",
      referralCode: newReferralCode,
      referredBy: validatedReferrer ? validatedReferrer.referrerId : null,
      lastLoginAt: new Date(),
    });

    // Handle Referral attribution if applicable
    if (validatedReferrer) {
      try {
        const attribution = await createReferralAttribution({
          referrerId: validatedReferrer.referrerId,
          referredId: user._id,
          referralCode: referralCode.trim(),
        });
        if (attribution) {
          await processReferralReward({ referralId: attribution._id });
          const refreshed = await User.findById(user._id).select("rewardPoints");
          if (refreshed) user.rewardPoints = refreshed.rewardPoints;
        }
      } catch (rewardErr) {
        console.error("[Referral Reward Processing Error]:", rewardErr);
      }
    }

    // Delete used OTP document
    await CustomerOtp.deleteOne({ _id: otpDoc._id });

    // Generate access token for instant auto-login
    const token = generateAccessToken(user);

    res.status(201).json({
      success: true,
      message: "Customer account created successfully.",
      data: {
        token,
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Customer Password Login
 * @route   POST /api/customer/auth/login
 * @access  Public
 */
export const passwordLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return next(new AppError("Email and password are required.", 400));
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "No customer account found with this email. Continue with Email OTP to register.",
        isUnregistered: true,
      });
    }

    // Ensure role is Customer
    if (user.role === "vendor") {
      return res.status(403).json({
        success: false,
        message:
          "This account is registered as a Vendor. Please log in through the Vendor Portal.",
        isVendor: true,
      });
    }

    if (user.role === "delivery_boy") {
      return res.status(403).json({
        success: false,
        message:
          "This account is registered as a Delivery Partner. Please log in through the Delivery App.",
        isDeliveryBoy: true,
      });
    }

    // Check if account has no password set (e.g., Google sign-in)
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message:
          "Your account does not have a password set. Please log in using Email OTP or Google.",
        hasNoPassword: true,
      });
    }

    // Validate password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password. Please try again or use Email OTP.",
      });
    }

    // Check active status
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateAccessToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: {
        token,
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Google OAuth Sign-In & Instant Registration for Customers
 * @route   POST /api/customer/auth/google
 * @access  Public
 */
export const googleAuth = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return next(new AppError("Google ID Token is required.", 400));
    }

    // Cryptographically verify ID token with Google
    const googleUser = await verifyGoogleIdToken(idToken);
    const { email, name, picture, googleId } = googleUser;

    let user = await User.findOne({ email });

    if (user) {
      // Role validation
      if (user.role === "vendor") {
        return res.status(403).json({
          success: false,
          message:
            "This email is registered as a Vendor. Please sign in via the Vendor Portal.",
          isVendor: true,
        });
      }
      if (user.role === "delivery_boy") {
        return res.status(403).json({
          success: false,
          message:
            "This email is registered as a Delivery Partner. Please sign in via the Delivery App.",
          isDeliveryBoy: true,
        });
      }

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Your account has been deactivated. Please contact support.",
        });
      }

      // Link Google ID if not already linked
      let shouldSave = false;
      if (!user.googleId) {
        user.googleId = googleId;
        shouldSave = true;
      }
      if (!user.avatar && picture) {
        user.avatar = picture;
        shouldSave = true;
      }
      user.lastLoginAt = new Date();
      user.isEmailVerified = true;
      shouldSave = true;

      if (shouldSave) {
        await user.save({ validateBeforeSave: false });
      }

      const token = generateAccessToken(user);

      return res.status(200).json({
        success: true,
        isNewCustomer: false,
        message: "Google sign-in successful.",
        data: {
          token,
          user: sanitizeUser(user),
        },
      });
    }

    // ── NEW CUSTOMER VIA GOOGLE: AUTO-CREATE WITHOUT PASSWORD ──
    const referralCode = await generateUniqueReferralCode(name || "Customer");

    user = await User.create({
      name: name || "Customer",
      email,
      googleId,
      avatar: picture || "",
      role: "customer",
      isEmailVerified: true,
      authProvider: "google",
      referralCode,
      lastLoginAt: new Date(),
    });

    const token = generateAccessToken(user);

    res.status(201).json({
      success: true,
      isNewCustomer: true,
      message: "Google account created successfully.",
      data: {
        token,
        user: sanitizeUser(user),
      },
    });
  } catch (error) {
    next(error);
  }
};

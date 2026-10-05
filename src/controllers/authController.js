import User from "../models/User.js";
import { generateOTP } from "../utils/generateOTP.js";
import {
  generateAccessToken,
  generateResetToken,
  verifyResetToken,
} from "../utils/generateToken.js";
import {
  sendVerificationOTP,
  sendPasswordResetOTP,
  sendPasswordChangedEmail,
} from "../utils/sendEmail.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password, address, dateOfBirth, gender } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError("An account with this email already exists.", 400));
    }

    // Create user directly with verified status
    const user = await User.create({
      name,
      email,
      password,
      address: address || "",
      dateOfBirth,
      gender,
      isEmailVerified: true,
      lastLoginAt: new Date(),
    });

    // Generate JWT access token for instant auto-login
    const token = generateAccessToken(user);

    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      address: user.address,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
    };

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      data: {
        user: userResponse,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify email address using OTP
 * @route   POST /api/auth/verify-email
 * @access  Public
 */
export const verifyEmail = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select(
      "+emailVerificationOTP +emailVerificationOTPExpires"
    );

    if (!user) {
      return next(new AppError("No account found with this email address.", 404));
    }

    if (user.isEmailVerified) {
      return next(new AppError("Email is already verified. You can log in directly.", 400));
    }

    if (!user.emailVerificationOTP || user.emailVerificationOTP !== otp) {
      return next(new AppError("Invalid verification code.", 400));
    }

    if (user.emailVerificationOTPExpires < new Date()) {
      return next(
        new AppError(
          "Verification code has expired. Please request a new verification code.",
          400
        )
      );
    }

    // Mark email as verified and clear OTP fields
    user.isEmailVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpires = undefined;
    user.lastVerificationEmailSentAt = undefined;

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Email verified successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resend email verification OTP
 * @route   POST /api/auth/resend-verification-otp
 * @access  Public
 */
export const resendVerificationOTP = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email }).select(
      "+isEmailVerified +lastVerificationEmailSentAt"
    );

    if (!user) {
      return next(new AppError("No account found with this email address.", 404));
    }

    if (user.isEmailVerified) {
      return next(new AppError("Email is already verified. Please log in.", 400));
    }

    // Rate-limiting check: minimum 60 seconds between resend requests
    if (user.lastVerificationEmailSentAt) {
      const timeSinceLastEmail = Date.now() - new Date(user.lastVerificationEmailSentAt).getTime();
      const cooldownMs = 60 * 1000; // 60 seconds
      if (timeSinceLastEmail < cooldownMs) {
        const waitSeconds = Math.ceil((cooldownMs - timeSinceLastEmail) / 1000);
        return next(
          new AppError(
            `Please wait ${waitSeconds} seconds before requesting a new OTP.`,
            429
          )
        );
      }
    }

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.emailVerificationOTP = otp;
    user.emailVerificationOTPExpires = otpExpires;
    user.lastVerificationEmailSentAt = new Date();

    await user.save({ validateBeforeSave: false });

    await sendVerificationOTP(user.email, otp);

    res.status(200).json({
      success: true,
      message: "Verification OTP sent successfully to your email.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Log in user & get access token
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user with password
    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await user.comparePassword(password))) {
      return next(new AppError("Invalid email or password.", 401));
    }

    // Check if account is active
    if (!user.isActive) {
      return next(
        new AppError("Your account has been deactivated. Please contact support.", 403)
      );
    }

    // Update last login timestamp
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    // Generate JWT access token
    const token = generateAccessToken(user);

    // Prepare clean response object (excluding password & sensitive fields)
    const userResponse = {
      _id: user._id,
      name: user.name,
      email: user.email,
      address: user.address,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
    };

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: userResponse,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get currently logged in user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = async (req, res, next) => {
  try {
    // req.user is populated by protect middleware
    res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Send password reset OTP
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });

    // Prevent account enumeration by always returning generic success response
    const genericResponse = {
      success: true,
      message: "If an account exists with this email, a verification code has been sent.",
    };

    if (!user) {
      return res.status(200).json(genericResponse);
    }

    // Generate 6-digit secure OTP
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.resetPasswordOTP = otp;
    user.resetPasswordOTPExpires = otpExpires;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;

    await user.save({ validateBeforeSave: false });

    await sendPasswordResetOTP(user.email, otp);

    res.status(200).json(genericResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify reset OTP and issue a short-lived reset token
 * @route   POST /api/auth/verify-reset-otp
 * @access  Public
 */
export const verifyResetOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email }).select(
      "+resetPasswordOTP +resetPasswordOTPExpires"
    );

    if (!user || !user.resetPasswordOTP || user.resetPasswordOTP !== otp) {
      return next(new AppError("Invalid verification code.", 400));
    }

    if (user.resetPasswordOTPExpires < new Date()) {
      return next(
        new AppError(
          "Verification code has expired. Please request a new password reset code.",
          400
        )
      );
    }

    // Generate short-lived reset token (valid for 10 minutes)
    const resetToken = generateResetToken(user._id);

    // Invalidate the OTP so it can only be used once, save reset token state
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    user.resetPasswordToken = resetToken;
    user.resetPasswordTokenExpires = new Date(Date.now() + 10 * 60 * 1000);

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      resetToken,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset password using reset token
 * @route   POST /api/auth/reset-password
 * @access  Public
 */
export const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, password } = req.body;

    // Verify token validity & signature
    let decoded;
    try {
      decoded = verifyResetToken(resetToken);
    } catch {
      return next(new AppError("Invalid or expired reset token. Please restart the reset process.", 400));
    }

    if (!decoded || decoded.purpose !== "password_reset") {
      return next(new AppError("Invalid reset token.", 400));
    }

    // Find user with reset token state
    const user = await User.findById(decoded.userId).select(
      "+resetPasswordToken +resetPasswordTokenExpires"
    );

    if (
      !user ||
      !user.resetPasswordToken ||
      user.resetPasswordToken !== resetToken ||
      user.resetPasswordTokenExpires < new Date()
    ) {
      return next(
        new AppError("Reset token is invalid or has already been used.", 400)
      );
    }

    // Update password (pre-save hook will hash it)
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;
    user.resetPasswordOTP = undefined;
    user.resetPasswordOTPExpires = undefined;
    user.passwordChangedAt = new Date();

    await user.save();

    // Send confirmation email
    await sendPasswordChangedEmail(user.email);

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change password for authenticated logged-in user
 * @route   POST /api/auth/change-password
 * @access  Private
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      return next(new AppError("User not found.", 404));
    }

    // Validate current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return next(new AppError("Current password is incorrect.", 400));
    }

    // Check if new password is identical to old password
    if (currentPassword === newPassword) {
      return next(
        new AppError("New password must be different from your current password.", 400)
      );
    }

    // Update password (pre-save hook will hash it)
    user.password = newPassword;
    user.passwordChangedAt = new Date();

    await user.save();

    // Send confirmation email
    await sendPasswordChangedEmail(user.email);

    res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Log out user / clear session
 * @route   POST /api/auth/logout
 * @access  Public
 */
export const logout = async (req, res) => {
  // Clear cookie if cookie authentication is used
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

/**
 * @desc    Update user profile (Name, Gender, Date of Birth, Address)
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateProfile = async (req, res, next) => {
  try {
    const { name, gender, dateOfBirth, address } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    if (name) user.name = name.trim();
    if (gender) user.gender = gender;
    if (dateOfBirth) user.dateOfBirth = new Date(dateOfBirth);
    if (address !== undefined) user.address = address.trim();

    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload user avatar to Cloudinary & store URL on MongoDB
 * @route   POST /api/auth/profile/avatar or PUT /api/auth/profile/avatar
 * @access  Private
 */
export const uploadAvatar = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    let fileSource = null;

    if (req.file) {
      // From multipart/form-data via multer buffer
      fileSource = req.file.buffer;
    } else if (req.body.image || req.body.avatar || req.body.base64) {
      // From base64 string or data uri
      fileSource = req.body.image || req.body.avatar || req.body.base64;
    }

    if (!fileSource) {
      return next(new AppError("Please provide an image to upload.", 400));
    }

    // If user already has an existing avatar on Cloudinary, remove old image
    if (user.avatar) {
      await deleteFromCloudinary(user.avatar);
    }

    // Upload new image to Cloudinary
    const result = await uploadToCloudinary(fileSource, "bhansamart/avatars");

    // Save secure URL to MongoDB User
    user.avatar = result.secure_url;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Profile photo uploaded successfully.",
      data: {
        avatar: user.avatar,
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove user profile avatar from Cloudinary & MongoDB
 * @route   DELETE /api/auth/profile/avatar
 * @access  Private
 */
export const removeAvatar = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    if (user.avatar) {
      await deleteFromCloudinary(user.avatar);
    }

    user.avatar = "";
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      success: true,
      message: "Profile photo removed successfully.",
      data: {
        user,
      },
    });
  } catch (error) {
    next(error);
  }
};

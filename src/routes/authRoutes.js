import express from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  verifyEmail,
  resendVerificationOTP,
  login,
  getMe,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  changePassword,
  logout,
  updateProfile,
  uploadAvatar,
  removeAvatar,
} from "../controllers/authController.js";
import {
  validateRegister,
  validateVerifyEmail,
  validateResendOTP,
  validateLogin,
  validateForgotPassword,
  validateVerifyResetOTP,
  validateResetPassword,
  validateChangePassword,
} from "../middleware/validationMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = express.Router();

// Rate limiter for general authentication requests (login, register, forgot-password)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 auth requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

// Strict rate limiter for OTP operations
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // limit each IP to 10 OTP requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP verification attempts. Please try again later.",
  },
});

// ==========================================
// Public Authentication Routes
// ==========================================

// Screen 2: Create Account / Signup
router.post("/register", authLimiter, validateRegister, register);

// Screen 4: Email Verification OTP
router.post("/verify-email", otpLimiter, validateVerifyEmail, verifyEmail);
router.post("/resend-verification-otp", otpLimiter, validateResendOTP, resendVerificationOTP);

// Screen 1: Login & Logout
router.post("/login", authLimiter, validateLogin, login);
router.post("/logout", logout);

// Screen 3: Forgot Password Flow
router.post("/forgot-password", authLimiter, validateForgotPassword, forgotPassword);
router.post("/verify-reset-otp", otpLimiter, validateVerifyResetOTP, verifyResetOTP);
router.post("/reset-password", authLimiter, validateResetPassword, resetPassword);

// ==========================================
// Protected Routes (Require Authentication)
// ==========================================

// Screen 5: Change Password (Logged-in User)
router.post("/change-password", protect, validateChangePassword, changePassword);

// Current User Profile & Profile Update
router.get("/me", protect, getMe);
router.put("/profile", protect, updateProfile);

// Avatar Upload & Delete (Cloudinary Integration)
router.post("/profile/avatar", protect, upload.single("avatar"), uploadAvatar);
router.put("/profile/avatar", protect, upload.single("avatar"), uploadAvatar);
router.delete("/profile/avatar", protect, removeAvatar);

export default router;

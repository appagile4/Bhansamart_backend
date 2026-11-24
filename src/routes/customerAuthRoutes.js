import express from "express";
import rateLimit from "express-rate-limit";
import {
  checkEmail,
  sendOtp,
  verifyOtp,
  completeRegistration,
  passwordLogin,
  googleAuth,
} from "../controllers/customerAuthController.js";
import { protect } from "../middleware/authMiddleware.js";
import { getMe } from "../controllers/authController.js";

const router = express.Router();

// Rate limiter for general customer auth requests
const customerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

// Stricter rate limiter for OTP endpoints
const customerOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 mins
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP requests from this connection. Please try again in 10 minutes.",
  },
});

// 1. Check Customer Email
router.post("/check-email", customerAuthLimiter, checkEmail);

// 2. Email OTP Flow
router.post("/send-otp", customerOtpLimiter, sendOtp);
router.post("/verify-otp", customerOtpLimiter, verifyOtp);
router.post("/complete-registration", customerAuthLimiter, completeRegistration);

// 3. Email & Password Flow
router.post("/login", customerAuthLimiter, passwordLogin);

// 4. Google Authentication
router.post("/google", customerAuthLimiter, googleAuth);

// 5. Current Authenticated Customer Profile
router.get("/me", protect, getMe);

export default router;

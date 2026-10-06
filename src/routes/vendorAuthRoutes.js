import { Router } from "express";
import {
  registerVendor,
  loginVendorWithPassword,
  requestVendorOTP,
  verifyVendorOTPLogin,
  getMyVendorProfile,
} from "../controllers/vendorAuthController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = Router();

// Public vendor auth endpoints
router.post("/register", registerVendor);
router.post("/login", loginVendorWithPassword);
router.post("/send-otp", requestVendorOTP);
router.post("/verify-otp", verifyVendorOTPLogin);

// Protected vendor auth endpoints
router.get("/me", protect, authorizeRoles("vendor", "admin"), getMyVendorProfile);

export default router;

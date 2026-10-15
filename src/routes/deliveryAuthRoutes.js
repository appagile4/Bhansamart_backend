import express from "express";
import {
  registerDeliveryBoy,
  loginDeliveryBoy,
  getMyDeliveryProfile,
  updateDeliveryProfile,
  uploadDeliveryProfilePhoto,
  updateDeliveryBankDetails,
} from "../controllers/deliveryAuthController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.post("/register", registerDeliveryBoy);
router.post("/login", loginDeliveryBoy);

// Protected routes
router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.get("/me", getMyDeliveryProfile);
router.put("/me", updateDeliveryProfile);

// Profile photo upload to Cloudinary & MongoDB
router.post("/profile-photo", uploadSingleImage("profilePhoto"), uploadDeliveryProfilePhoto);

// Bank & Wallet payout details
router.put("/bank-details", updateDeliveryBankDetails);

export default router;

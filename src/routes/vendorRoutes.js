import { Router } from "express";
import {
  getMyVendor,
  updateVendorSection,
  uploadVendorLogo,
  getApprovedVendors,
} from "../controllers/vendorController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router = Router();

// Public routes
router.get("/approved", getApprovedVendors);

// Protected vendor routes
router.get("/profile", protect, authorizeRoles("vendor", "admin"), getMyVendor);
router.put(
  "/update-section",
  protect,
  authorizeRoles("vendor", "admin"),
  updateVendorSection
);
router.post(
  "/upload-logo",
  protect,
  authorizeRoles("vendor", "admin"),
  uploadSingleImage("logo"),
  uploadVendorLogo
);

export default router;

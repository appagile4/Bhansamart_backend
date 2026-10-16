import { Router } from "express";
import {
  getBrands,
  searchBrands,
  searchBrandLogos,
  createBrandRequest,
  getMyBrandRequests,
} from "../controllers/brandController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router = Router();

// Public brand exploration
router.get("/", getBrands);
router.get("/search", searchBrands);

// Vendor Protected routes
router.get("/logo-search", protect, authorizeRoles("vendor", "admin"), searchBrandLogos);
router.get("/my-requests", protect, authorizeRoles("vendor", "admin"), getMyBrandRequests);
router.post(
  "/request",
  protect,
  authorizeRoles("vendor", "admin"),
  uploadSingleImage("logo"),
  createBrandRequest
);

export default router;

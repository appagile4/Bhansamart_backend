import { Router } from "express";
import {
  createProduct,
  getVendorProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  toggleProductStock,
} from "../controllers/productController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";

const router = Router();

// ─── VENDOR PROTECTED PRODUCT ENDPOINTS ───────────────────────

// 1. My Vendor Products (List & Filter)
router.get("/my-products", protect, getVendorProducts);
router.get("/vendor", protect, getVendorProducts);

// 2. Create Product (with Cloudinary image uploads)
router.post("/", protect, upload.array("images", 10), createProduct);

// 3. Single Product by ID or Slug
router.get("/:id", getProductById);

// 4. Update Product
router.put("/:id", protect, upload.array("images", 10), updateProduct);

// 5. Toggle Product Stock status
router.patch("/:id/toggle-stock", protect, toggleProductStock);

// 6. Delete Product
router.delete("/:id", protect, deleteProduct);

export default router;

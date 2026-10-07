import { Router } from "express";
import {
  createProduct,
  getVendorProducts,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  toggleProductStock,
  recordProductView,
  recordProductOrder,
  recordProductRefund,
} from "../controllers/productController.js";
import { protect } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import reviewRoutes from "./reviewRoutes.js";

const router = Router();

// ─── NESTED REVIEW ROUTES ────────────────────────────────────
router.use("/:productId/reviews", reviewRoutes);

// ─── PUBLIC CUSTOMER PRODUCT ENDPOINTS ───────────────────────
router.get("/", getAllProducts);

// ─── PERFORMANCE METRICS TRACKING (Views, Orders, Refunds) ───
router.post("/:id/view", recordProductView);
router.post("/:id/order", recordProductOrder);
router.post("/:id/refund", recordProductRefund);

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



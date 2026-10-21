import express from "express";
import {
  createOrder,
  getMyOrders,
  getOrderById,
  getVendorOrders,
  updateOrderStatus,
  cancelCustomerOrder,
} from "../controllers/orderController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// ── Customer Order Endpoints ──────────────────────────────────────────
router.post("/", protect, createOrder);
router.get("/my-orders", protect, getMyOrders);
router.post("/:id/cancel", protect, cancelCustomerOrder);

// ── Vendor Order Endpoints ────────────────────────────────────────────
router.get(
  "/vendor/live",
  protect,
  authorizeRoles("vendor", "admin", "superadmin"),
  getVendorOrders
);
router.patch(
  "/:id/status",
  protect,
  authorizeRoles("vendor", "admin", "superadmin"),
  updateOrderStatus
);

// ── Shared Single Order Details ───────────────────────────────────────
router.get("/:id", protect, getOrderById);

export default router;

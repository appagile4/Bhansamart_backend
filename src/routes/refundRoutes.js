import express from "express";
import {
  requestRefund,
  approveRefund,
  rejectRefund,
  getMyRefunds,
  getVendorRefunds,
  getRefundById,
} from "../controllers/refundController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Customer endpoints
router.post("/request", requestRefund);
router.get("/my-refunds", getMyRefunds);

// Vendor endpoints
router.get("/vendor", getVendorRefunds);

// Shared / Action endpoints
router.patch("/:id/approve", approveRefund);
router.patch("/:id/reject", rejectRefund);
router.get("/:id", getRefundById);

export default router;

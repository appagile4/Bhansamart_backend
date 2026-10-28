import express from "express";
import {
  requestRefund,
  approveRefund,
  rejectRefund,
  getMyRefunds,
  getVendorRefunds,
  vendorReviewRefund,
  vendorAcknowledgeClaim,
  vendorDirectRefundPayout,
  superAdminProcessOnlineRefund,
  adminAssignReturnPickup,
  deliveryBoySubmitReturnInspection,
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
router.patch("/:id/vendor-review", vendorReviewRefund);
router.patch("/:id/vendor-acknowledge", vendorAcknowledgeClaim);
router.patch("/:id/vendor-direct-payout", vendorDirectRefundPayout);

// Super Admin endpoints
router.patch("/:id/superadmin-online-payout", superAdminProcessOnlineRefund);
router.patch("/:id/assign-pickup", adminAssignReturnPickup);

// Delivery Partner endpoints
router.patch("/:id/delivery-inspection", deliveryBoySubmitReturnInspection);

// Shared / Action endpoints
router.patch("/:id/approve", approveRefund);
router.patch("/:id/reject", rejectRefund);
router.get("/:id", getRefundById);

export default router;

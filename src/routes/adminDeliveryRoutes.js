import express from "express";
import {
  getAllDeliveryPartners,
  getDeliveryPartnerById,
  reviewPartnerDocument,
  updatePartnerApproval,
  getAllSecurityDeposits,
  processDepositRefund,
} from "../controllers/adminDeliveryController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("admin", "superadmin"));

router.get("/partners", getAllDeliveryPartners);
router.get("/partners/:id", getDeliveryPartnerById);
router.patch("/partners/:id/document", reviewPartnerDocument);
router.patch("/partners/:id/approval", updatePartnerApproval);
router.get("/deposits", getAllSecurityDeposits);
router.post("/partners/:id/refund-deposit", processDepositRefund);

export default router;

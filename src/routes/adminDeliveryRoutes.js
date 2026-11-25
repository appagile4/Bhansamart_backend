import express from "express";
import {
  getAllDeliveryPartners,
  getDeliveryPartnerById,
  reviewPartnerDocument,
  updatePartnerApproval,
  getAllSecurityDeposits,
  processDepositRefund,
  getDispatchOverview,
  getDispatchRadar,
  manualAssignOrder,
  getDispatchSettings,
  updateDispatchSettings,
} from "../controllers/adminDeliveryController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("admin", "superadmin"));

// Partner Management & Approvals
router.get("/partners", getAllDeliveryPartners);
router.get("/partners/:id", getDeliveryPartnerById);
router.patch("/partners/:id/document", reviewPartnerDocument);
router.patch("/partners/:id/approval", updatePartnerApproval);
router.get("/deposits", getAllSecurityDeposits);
router.post("/partners/:id/refund-deposit", processDepositRefund);

// Dispatch Radar & Settings
router.get("/dispatch/overview", getDispatchOverview);
router.get("/dispatch/radar", getDispatchRadar);
router.post("/dispatch/manual-assign", manualAssignOrder);
router.get("/dispatch/settings", getDispatchSettings);
router.put("/dispatch/settings", updateDispatchSettings);

export default router;

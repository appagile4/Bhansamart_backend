import express from "express";
import {
  getAdminReferralCampaign,
  updateAdminReferralCampaign,
  getAdminReferralsList,
  adminManualPointAdjustment,
} from "../controllers/adminReferralController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Strict Admin-only Authorization
router.use(protect, authorizeRoles("admin", "superadmin"));

router.get("/campaign", getAdminReferralCampaign);
router.put("/campaign", updateAdminReferralCampaign);
router.get("/", getAdminReferralsList);
router.post("/manual-adjustment", adminManualPointAdjustment);

export default router;

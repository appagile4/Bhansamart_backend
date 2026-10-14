import express from "express";
import { getEarningsSummary } from "../controllers/deliveryEarningsController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.get("/summary", getEarningsSummary);

export default router;

import express from "express";
import {
  initiateDeposit,
  handleDepositWebhook,
  getDepositStatus,
  requestDepositRefund,
} from "../controllers/deliveryDepositController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Webhook endpoint (can be invoked by payment gateway callback or simulated directly)
router.post("/webhook", handleDepositWebhook);

// Protected routes for delivery boy
router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.post("/initiate", initiateDeposit);
router.get("/status", getDepositStatus);
router.post("/refund-request", requestDepositRefund);

export default router;

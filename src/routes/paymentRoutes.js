import express from "express";
import {
  initializePayment,
  verifyPayment,
  handlePaymentWebhook,
  getPaymentStatus,
} from "../controllers/paymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public gateway webhook endpoint
router.post("/webhook", handlePaymentWebhook);

// Protected customer payment routes
router.use(protect);
router.post("/initialize", initializePayment);
router.post("/verify", verifyPayment);
router.get("/status/:orderId", getPaymentStatus);

export default router;

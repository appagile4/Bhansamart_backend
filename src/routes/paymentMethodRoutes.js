import express from "express";
import {
  getPaymentMethods,
  addCard,
  linkWallet,
  unlinkWallet,
  addNetbanking,
  deletePaymentMethod,
} from "../controllers/paymentMethodController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

router.get("/", getPaymentMethods);
router.post("/cards", addCard);
router.post("/wallets/link", linkWallet);
router.delete("/wallets/:walletType", unlinkWallet);
router.post("/netbanking", addNetbanking);
router.delete("/:id", deletePaymentMethod);

export default router;

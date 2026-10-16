import express from "express";
import {
  getMyReferral,
  getMyReferralsHistory,
  validateCode,
  getRewardsWallet,
  getRewardTransactions,
} from "../controllers/referralController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public referral code validation
router.post("/validate", validateCode);

// Protected Customer Referral Endpoints
router.get("/me", protect, getMyReferral);
router.get("/me/history", protect, getMyReferralsHistory);

// Also expose wallet and transaction routes under rewards router
export const rewardsRouter = express.Router();
rewardsRouter.get("/wallet", protect, getRewardsWallet);
rewardsRouter.get("/transactions", protect, getRewardTransactions);

export default router;

import mongoose from "mongoose";
import User from "../models/User.js";
import RewardTransaction from "../models/RewardTransaction.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Atomically credit points to a user's wallet with deterministic idempotency
 */
export const creditPoints = async ({
  userId,
  points,
  reason,
  idempotencyKey,
  referralId = null,
  metadata = {},
  session = null,
}) => {
  const pointsInt = Math.floor(Number(points));
  if (isNaN(pointsInt) || pointsInt <= 0) {
    throw new AppError("Point amount must be a positive integer", 400);
  }

  // 1. Idempotency Check: If already processed, return existing record
  const existingTxn = await RewardTransaction.findOne({
    idempotencyKey,
  }).session(session);
  if (existingTxn) {
    return {
      transaction: existingTxn,
      alreadyProcessed: true,
      newBalance: existingTxn.balanceAfter,
    };
  }

  // 2. Fetch User
  const userQuery = User.findById(userId);
  if (session) userQuery.session(session);
  const user = await userQuery;

  if (!user) {
    throw new AppError(`User ${userId} not found for point crediting`, 404);
  }

  // 3. Atomically update user balance
  const currentBalance = Math.max(0, Number(user.rewardPoints) || 0);
  const newBalance = currentBalance + pointsInt;

  user.rewardPoints = newBalance;
  await user.save({ session });

  // 4. Create Auditable Ledger Record
  const [transaction] = await RewardTransaction.create(
    [
      {
        user: user._id,
        referral: referralId,
        type: "CREDIT",
        reason,
        points: pointsInt,
        balanceAfter: newBalance,
        idempotencyKey,
        status: "COMPLETED",
        metadata,
      },
    ],
    { session }
  );

  return {
    transaction,
    alreadyProcessed: false,
    newBalance,
  };
};

/**
 * Get authoritative summary of a user's reward points
 */
export const getWalletSummary = async (userId) => {
  const user = await User.findById(userId).select("rewardPoints name email");
  if (!user) {
    throw new AppError("User not found", 404);
  }

  const [totals] = await RewardTransaction.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        lifetimeEarned: {
          $sum: {
            $cond: [{ $eq: ["$type", "CREDIT"] }, "$points", 0],
          },
        },
        lifetimeRedeemed: {
          $sum: {
            $cond: [{ $eq: ["$type", "DEBIT"] }, "$points", 0],
          },
        },
        lifetimeReversed: {
          $sum: {
            $cond: [{ $eq: ["$type", "REVERSAL"] }, "$points", 0],
          },
        },
        totalTransactions: { $sum: 1 },
      },
    },
  ]);

  const availablePoints = Math.max(0, Number(user.rewardPoints) || 0);
  const lifetimeEarned = totals ? totals.lifetimeEarned : availablePoints;
  const lifetimeRedeemed = totals ? totals.lifetimeRedeemed : 0;
  const lifetimeReversed = totals ? totals.lifetimeReversed : 0;

  return {
    availablePoints,
    lifetimeEarned,
    lifetimeRedeemed,
    lifetimeReversed,
    totalTransactions: totals ? totals.totalTransactions : 0,
  };
};

/**
 * Get paginated transactions ledger for user
 */
export const getUserTransactions = async (
  userId,
  { page = 1, limit = 20, type = null } = {}
) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query = { user: userId };
  if (type && ["CREDIT", "DEBIT", "REVERSAL"].includes(type.toUpperCase())) {
    query.type = type.toUpperCase();
  }

  const [transactions, total] = await Promise.all([
    RewardTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .populate("referral", "referralCode status createdAt")
      .lean(),
    RewardTransaction.countDocuments(query),
  ]);

  return {
    transactions,
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
    currentPage: pageNum,
  };
};

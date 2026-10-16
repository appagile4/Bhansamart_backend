import User from "../models/User.js";
import Referral from "../models/Referral.js";
import {
  ensureUserReferralCode,
  validateReferralCode,
  getActiveCampaign,
} from "../services/referralService.js";
import {
  getWalletSummary,
  getUserTransactions,
} from "../services/rewardLedgerService.js";
import {
  getCustomerNotifications as fetchNotifications,
  markNotificationRead as readSingleNotif,
  markAllNotificationsRead as readAllNotifs,
} from "../services/notificationService.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * @desc    Get current customer's referral code and metrics summary
 * @route   GET /api/v1/referrals/me
 * @access  Private (Customer)
 */
export const getMyReferral = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return next(new AppError("User not found", 404));
    }

    // Ensure referral code exists for the user
    const referralCode = await ensureUserReferralCode(user);

    // Aggregate referral metrics
    const [stats, activeCampaign] = await Promise.all([
      Referral.aggregate([
        { $match: { referrer: user._id } },
        {
          $group: {
            _id: null,
            totalInvited: { $sum: 1 },
            successfulReferrals: {
              $sum: { $cond: [{ $eq: ["$status", "REWARDED"] }, 1, 0] },
            },
            pendingReferrals: {
              $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] },
            },
            totalPointsEarned: {
              $sum: {
                $cond: [{ $eq: ["$status", "REWARDED"] }, "$referrerReward", 0],
              },
            },
          },
        },
      ]),
      getActiveCampaign(),
    ]);

    const metrics = stats[0] || {
      totalInvited: 0,
      successfulReferrals: 0,
      pendingReferrals: 0,
      totalPointsEarned: 0,
    };

    return res.status(200).json({
      success: true,
      data: {
        referralCode,
        rewardPointsBalance: Math.max(0, Number(user.rewardPoints) || 0),
        totalInvited: metrics.totalInvited,
        successfulReferrals: metrics.successfulReferrals,
        pendingReferrals: metrics.pendingReferrals,
        totalPointsEarned: metrics.totalPointsEarned,
        campaign: {
          name: activeCampaign.name,
          referrerRewardPoints: activeCampaign.referrerRewardPoints,
          newCustomerRewardPoints: activeCampaign.referredRewardPoints,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get paginated referral history for the authenticated customer
 * @route   GET /api/v1/referrals/me/history
 * @access  Private (Customer)
 */
export const getMyReferralsHistory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [referrals, total] = await Promise.all([
      Referral.find({ referrer: userId })
        .populate("referred", "name createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Referral.countDocuments({ referrer: userId }),
    ]);

    // Mask referred names for customer privacy
    const sanitizedHistory = referrals.map((ref) => {
      let displayName = "Friend";
      if (ref.referred && ref.referred.name) {
        const parts = ref.referred.name.trim().split(/\s+/);
        displayName = parts
          .map((p) => (p.length > 1 ? `${p[0]}***` : p))
          .join(" ");
      }

      return {
        _id: ref._id,
        referredName: displayName,
        registrationDate: ref.createdAt,
        rewardedAt: ref.rewardedAt,
        status: ref.status,
        pointsEarned: ref.status === "REWARDED" ? ref.referrerReward : 0,
        expectedPoints: ref.referrerReward,
      };
    });

    return res.status(200).json({
      success: true,
      count: sanitizedHistory.length,
      total,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: page,
      data: sanitizedHistory,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Validate a referral code without disclosing sensitive account information
 * @route   POST /api/v1/referrals/validate
 * @access  Public / Authenticated
 */
export const validateCode = async (req, res, next) => {
  try {
    const { code } = req.body;
    const currentUserId = req.user ? req.user._id : null;

    const result = await validateReferralCode(code, currentUserId);

    return res.status(200).json({
      success: true,
      message: `Valid referral code! You'll receive ${result.campaign.newCustomerWelcomePoints} welcome reward points upon signing up.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get authenticated customer's authoritative points balance and wallet summary
 * @route   GET /api/v1/rewards/wallet
 * @access  Private (Customer)
 */
export const getRewardsWallet = async (req, res, next) => {
  try {
    const summary = await getWalletSummary(req.user._id);

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get paginated ledger transactions for the authenticated customer
 * @route   GET /api/v1/rewards/transactions
 * @access  Private (Customer)
 */
export const getRewardTransactions = async (req, res, next) => {
  try {
    const { page, limit, type } = req.query;
    const result = await getUserTransactions(req.user._id, { page, limit, type });

    return res.status(200).json({
      success: true,
      data: result.transactions,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get paginated notifications for the authenticated customer
 * @route   GET /api/v1/notifications
 * @access  Private (Customer)
 */
export const getCustomerNotifications = async (req, res, next) => {
  try {
    const { page, limit, isRead } = req.query;
    const result = await fetchNotifications(req.user._id, { page, limit, isRead });

    return res.status(200).json({
      success: true,
      data: result.notifications,
      total: result.total,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark a customer notification as read
 * @route   PATCH /api/v1/notifications/:id/read
 * @access  Private (Customer)
 */
export const markNotificationAsRead = async (req, res, next) => {
  try {
    const notification = await readSingleNotif(req.params.id, req.user._id);

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: notification,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read for current customer
 * @route   PATCH /api/v1/notifications/read-all
 * @access  Private (Customer)
 */
export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const result = await readAllNotifs(req.user._id);

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

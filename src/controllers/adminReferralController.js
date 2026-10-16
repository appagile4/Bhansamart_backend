import Referral from "../models/Referral.js";
import ReferralCampaign from "../models/ReferralCampaign.js";
import RewardTransaction from "../models/RewardTransaction.js";
import { getActiveCampaign } from "../services/referralService.js";
import { creditPoints } from "../services/rewardLedgerService.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * @desc    Get current referral campaign and aggregate program analytics
 * @route   GET /api/v1/admin/referrals/campaign
 * @access  Private (Admin / Superadmin)
 */
export const getAdminReferralCampaign = async (req, res, next) => {
  try {
    const [campaign, stats] = await Promise.all([
      getActiveCampaign(),
      Referral.aggregate([
        {
          $group: {
            _id: null,
            totalReferrals: { $sum: 1 },
            rewardedReferrals: {
              $sum: { $cond: [{ $eq: ["$status", "REWARDED"] }, 1, 0] },
            },
            pendingReferrals: {
              $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] },
            },
            totalPointsAwarded: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "REWARDED"] },
                  { $add: ["$referrerReward", "$referredReward"] },
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const aggregate = stats[0] || {
      totalReferrals: 0,
      rewardedReferrals: 0,
      pendingReferrals: 0,
      totalPointsAwarded: 0,
    };

    return res.status(200).json({
      success: true,
      data: {
        campaign,
        metrics: {
          ...aggregate,
          conversionRate:
            aggregate.totalReferrals > 0
              ? `${Math.round(
                  (aggregate.rewardedReferrals / aggregate.totalReferrals) * 100
                )}%`
              : "0%",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update or create referral campaign settings
 * @route   PUT /api/v1/admin/referrals/campaign
 * @access  Private (Admin / Superadmin)
 */
export const updateAdminReferralCampaign = async (req, res, next) => {
  try {
    const {
      name,
      referrerRewardPoints,
      referredRewardPoints,
      isActive,
      startDate,
      endDate,
      maxReferralsPerUser,
      description,
    } = req.body;

    const campaign = await getActiveCampaign();

    if (name) campaign.name = name;
    if (referrerRewardPoints !== undefined) {
      const pts = parseInt(referrerRewardPoints, 10);
      if (isNaN(pts) || pts < 0) {
        return next(
          new AppError("Referrer reward points must be a nonnegative integer", 400)
        );
      }
      campaign.referrerRewardPoints = pts;
    }
    if (referredRewardPoints !== undefined) {
      const pts = parseInt(referredRewardPoints, 10);
      if (isNaN(pts) || pts < 0) {
        return next(
          new AppError("Referred reward points must be a nonnegative integer", 400)
        );
      }
      campaign.referredRewardPoints = pts;
    }
    if (isActive !== undefined) campaign.isActive = Boolean(isActive);
    if (startDate) campaign.startDate = new Date(startDate);
    if (endDate !== undefined) campaign.endDate = endDate ? new Date(endDate) : null;
    if (maxReferralsPerUser !== undefined) {
      campaign.maxReferralsPerUser = Math.max(0, parseInt(maxReferralsPerUser, 10) || 0);
    }
    if (description !== undefined) campaign.description = description;

    campaign.updatedBy = req.user._id;
    await campaign.save();

    return res.status(200).json({
      success: true,
      message: "Referral campaign settings updated successfully.",
      data: campaign,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List all referrals for administrative audit
 * @route   GET /api/v1/admin/referrals
 * @access  Private (Admin / Superadmin)
 */
export const getAdminReferralsList = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (status && status !== "ALL") {
      query.status = status.toUpperCase();
    }

    const [referrals, total] = await Promise.all([
      Referral.find(query)
        .populate("referrer", "name email phone referralCode")
        .populate("referred", "name email phone isEmailVerified createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Referral.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: referrals,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Admin manual point adjustment with mandatory audit reason & idempotency
 * @route   POST /api/v1/admin/referrals/manual-adjustment
 * @access  Private (Admin / Superadmin)
 */
export const adminManualPointAdjustment = async (req, res, next) => {
  try {
    const { userId, points, reason, idempotencyKey } = req.body;

    if (!userId || !points || !reason) {
      return next(
        new AppError("userId, points, and a valid audit reason are required.", 400)
      );
    }

    const generatedKey =
      idempotencyKey ||
      `admin:adj:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    const result = await creditPoints({
      userId,
      points: Math.abs(parseInt(points, 10)),
      reason: `Admin adjustment: ${reason}`,
      idempotencyKey: generatedKey,
      metadata: {
        adjustedBy: req.user._id,
        adminEmail: req.user.email,
        note: reason,
      },
    });

    return res.status(200).json({
      success: true,
      message: `Adjusted ${points} points for user. New balance: ${result.newBalance}`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

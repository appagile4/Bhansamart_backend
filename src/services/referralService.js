import mongoose from "mongoose";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import ReferralCampaign from "../models/ReferralCampaign.js";
import { creditPoints } from "./rewardLedgerService.js";
import { createNotification } from "./notificationService.js";
import { AppError } from "../middleware/errorMiddleware.js";

// Safe character set for referral codes (omits ambiguous chars 0, O, 1, I)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a random collision-resistant alphanumeric referral code
 */
const generateRandomCode = (length = 6) => {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return result;
};

/**
 * Generate a unique referral code for a user with retry loop on collision
 */
export const generateUniqueReferralCode = async (userName = "") => {
  let prefix = "BM";
  if (userName && userName.trim()) {
    const clean = userName
      .trim()
      .replace(/[^a-zA-Z]/g, "")
      .toUpperCase();
    if (clean.length >= 2) {
      prefix = clean.slice(0, 2);
    }
  }

  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `${prefix}${generateRandomCode(6)}`;
    const exists = await User.findOne({ referralCode: candidate }).lean();
    if (!exists) {
      return candidate;
    }
  }

  // Fallback with timestamp component if multiple collisions occur
  return `BM${Date.now().toString(36).toUpperCase().slice(-6)}`;
};

/**
 * Ensure a user has an active unique referral code (lazy initialization for existing users)
 */
export const ensureUserReferralCode = async (user, session = null) => {
  if (user.referralCode && user.referralCode.trim() !== "") {
    return user.referralCode;
  }

  const code = await generateUniqueReferralCode(user.name);
  user.referralCode = code;
  await user.save({ session });
  return code;
};

/**
 * Get active campaign or seed standard default campaign (100 / 50 pts)
 */
export const getActiveCampaign = async () => {
  const now = new Date();
  let campaign = await ReferralCampaign.findOne({
    isActive: true,
    startDate: { $lte: now },
    $or: [{ endDate: null }, { endDate: { $gte: now } }],
  }).sort({ createdAt: -1 });

  // If no campaign exists, seed the default baseline campaign
  if (!campaign) {
    campaign = await ReferralCampaign.create({
      name: "Welcome & Refer Program",
      isActive: true,
      referrerRewardPoints: 100,
      referredRewardPoints: 50,
      description: "Default registration-based referral campaign",
    });
  }

  return campaign;
};

/**
 * Validate a referral code without disclosing sensitive account details
 */
export const validateReferralCode = async (rawCode, requestingUserId = null) => {
  if (!rawCode || typeof rawCode !== "string") {
    throw new AppError("Referral code is required.", 400);
  }

  const normalizedCode = rawCode.trim().toUpperCase();
  if (normalizedCode.length < 4 || normalizedCode.length > 20) {
    throw new AppError("Invalid referral code format.", 400);
  }

  // 1. Locate referrer account
  const referrer = await User.findOne({ referralCode: normalizedCode }).select(
    "_id name status isActive role"
  );

  if (!referrer) {
    throw new AppError("Referral code not found or invalid.", 404);
  }

  if (referrer.status === "suspended" || referrer.isActive === false) {
    throw new AppError("This referral code is no longer active.", 400);
  }

  // 2. Prevent self-referral
  if (
    requestingUserId &&
    referrer._id.toString() === requestingUserId.toString()
  ) {
    throw new AppError("You cannot use your own referral code.", 400);
  }

  // 3. Check active campaign
  const campaign = await getActiveCampaign();
  if (!campaign || !campaign.isActive) {
    throw new AppError("There is currently no active referral campaign.", 400);
  }

  // 4. Check referrer limit if configured
  if (campaign.maxReferralsPerUser && campaign.maxReferralsPerUser > 0) {
    const currentReferralCount = await Referral.countDocuments({
      referrer: referrer._id,
      status: { $in: ["PENDING", "REWARDED"] },
    });
    if (currentReferralCount >= campaign.maxReferralsPerUser) {
      throw new AppError(
        "This referral code has reached its maximum invite limit.",
        400
      );
    }
  }

  // Mask referrer name for privacy (e.g. John Doe -> J*** D**)
  const parts = referrer.name.trim().split(/\s+/);
  const maskedName = parts
    .map((p) => (p.length > 1 ? `${p[0]}***` : p))
    .join(" ");

  return {
    valid: true,
    referrerId: referrer._id,
    referrerName: maskedName,
    campaign: {
      name: campaign.name,
      referrerRewardPoints: campaign.referrerRewardPoints,
      newCustomerWelcomePoints: campaign.referredRewardPoints,
    },
  };
};

/**
 * Create a referral attribution record for a newly registered user
 */
export const createReferralAttribution = async ({
  referrerId,
  referredId,
  referralCode,
  session = null,
}) => {
  // Prevent duplicate attribution for the same referred user
  const existingReferral = await Referral.findOne({
    referred: referredId,
  }).session(session);
  if (existingReferral) {
    return existingReferral;
  }

  const campaign = await getActiveCampaign();

  const [referral] = await Referral.create(
    [
      {
        referrer: referrerId,
        referred: referredId,
        referralCode: referralCode.trim().toUpperCase(),
        campaign: campaign._id,
        referrerReward: campaign.referrerRewardPoints,
        referredReward: campaign.referredRewardPoints,
        status: "PENDING",
        rewardStatus: "NOT_STARTED",
      },
    ],
    { session }
  );

  // Link referredBy on the user document
  await User.findByIdAndUpdate(
    referredId,
    { referredBy: referrerId },
    { session }
  );

  return referral;
};

/**
 * ATOMIC & EXACTLY-ONCE REWARD PROCESSING
 * Processes points credits for both referrer and new customer atomically
 */
export const processReferralReward = async ({ referralId, externalSession = null }) => {
  const executeRewardLogic = async (session) => {
    // 1. Fetch referral with write lock in transaction
    const referral = await Referral.findById(referralId).session(session);
    if (!referral) {
      throw new AppError(`Referral ${referralId} not found`, 404);
    }

    // If already rewarded, return existing state (Idempotent response)
    if (referral.status === "REWARDED") {
      return {
        success: true,
        alreadyProcessed: true,
        referral,
        message: "Referral was already rewarded.",
      };
    }

    if (referral.status === "REJECTED" || referral.status === "EXPIRED") {
      throw new AppError(
        `Referral is in an ineligible state: ${referral.status}`,
        400
      );
    }

    // 2. Validate both users
    const [referrerUser, referredUser] = await Promise.all([
      User.findById(referral.referrer).session(session),
      User.findById(referral.referred).session(session),
    ]);

    if (!referrerUser) {
      referral.status = "REJECTED";
      referral.rejectionReason = "Referrer account was removed or not found.";
      await referral.save({ session });
      throw new AppError("Referrer account not found", 404);
    }

    if (!referredUser) {
      referral.status = "REJECTED";
      referral.rejectionReason = "Referred user account not found.";
      await referral.save({ session });
      throw new AppError("Referred user account not found", 404);
    }

    if (
      referrerUser.status === "suspended" ||
      referredUser.status === "suspended"
    ) {
      referral.status = "REJECTED";
      referral.rejectionReason = "One or more accounts are suspended.";
      await referral.save({ session });
      throw new AppError("Referral involves a suspended account", 403);
    }

    // 3. Mark in-progress
    referral.rewardStatus = "PROCESSING";
    await referral.save({ session });

    // 4. Deterministic Idempotency Keys
    const referrerIdempotencyKey = `referral:${referral._id}:referrer`;
    const referredIdempotencyKey = `referral:${referral._id}:referred`;

    // 5. Credit Referrer
    const referrerCredit = await creditPoints({
      userId: referrerUser._id,
      points: referral.referrerReward,
      reason: `Referral bonus for inviting ${referredUser.name || "friend"}`,
      idempotencyKey: referrerIdempotencyKey,
      referralId: referral._id,
      metadata: {
        campaignId: referral.campaign,
        referredUserId: referredUser._id,
      },
      session,
    });

    // 6. Credit Referred User
    const referredCredit = await creditPoints({
      userId: referredUser._id,
      points: referral.referredReward,
      reason: "Welcome bonus for signing up via referral",
      idempotencyKey: referredIdempotencyKey,
      referralId: referral._id,
      metadata: {
        campaignId: referral.campaign,
        referrerUserId: referrerUser._id,
      },
      session,
    });

    // 7. Queue Durable In-App Notifications
    await Promise.all([
      createNotification({
        userId: referrerUser._id,
        title: "Referral Reward Earned! 🎁",
        message: `Your referral was successful! You've earned ${referral.referrerReward} reward points.`,
        type: "referral_reward",
        data: {
          referralId: referral._id,
          points: referral.referrerReward,
        },
        idempotencyKey: `notif:${referrerIdempotencyKey}`,
        session,
      }),
      createNotification({
        userId: referredUser._id,
        title: "Welcome Bonus Credited! 🎉",
        message: `Welcome to Bhansa Mart! You've received ${referral.referredReward} reward points.`,
        type: "welcome_reward",
        data: {
          referralId: referral._id,
          points: referral.referredReward,
        },
        idempotencyKey: `notif:${referredIdempotencyKey}`,
        session,
      }),
    ]);

    // 8. Finalize Referral Status
    referral.status = "REWARDED";
    referral.rewardStatus = "COMPLETED";
    referral.rewardedAt = new Date();
    await referral.save({ session });

    return {
      success: true,
      alreadyProcessed: false,
      referral,
      referrerPoints: referral.referrerReward,
      referredPoints: referral.referredReward,
      referrerNewBalance: referrerCredit.newBalance,
      referredNewBalance: referredCredit.newBalance,
    };
  };

  // If session is passed from parent transaction, reuse it
  if (externalSession) {
    return await executeRewardLogic(externalSession);
  }

  // Otherwise, initiate atomic session with transaction
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await executeRewardLogic(session);
      });
    } catch (txError) {
      // If MongoDB standalone doesn't support replica set transactions, execute safely sequentially
      if (
        txError.message &&
        txError.message.includes(
          "Transaction numbers are only allowed on a replica set member or mongos"
        )
      ) {
        console.warn(
          "[Referral Warning] Standalone MongoDB detected without replica set. Executing atomic operations sequentially."
        );
        result = await executeRewardLogic(null);
      } else {
        throw txError;
      }
    }
    return result;
  } finally {
    session.endSession();
  }
};

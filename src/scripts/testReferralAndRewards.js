import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import Referral from "../models/Referral.js";
import ReferralCampaign from "../models/ReferralCampaign.js";
import RewardTransaction from "../models/RewardTransaction.js";
import Notification from "../models/Notification.js";
import {
  generateUniqueReferralCode,
  ensureUserReferralCode,
  validateReferralCode,
  createReferralAttribution,
  processReferralReward,
  getActiveCampaign,
} from "../services/referralService.js";
import {
  creditPoints,
  getWalletSummary,
  getUserTransactions,
} from "../services/rewardLedgerService.js";
import {
  getCustomerNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/notificationService.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

const runTests = async () => {
  console.log("==========================================================");
  console.log("   TESTING REFERRAL & REWARDS POINTS SYSTEM (BACKEND)     ");
  console.log("==========================================================");

  let passed = 0;
  let failed = 0;

  const assert = (condition, description) => {
    if (condition) {
      console.log(`[PASS] ${description}`);
      passed++;
    } else {
      console.error(`[FAIL] ${description}`);
      failed++;
    }
  };

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[DB] Connected to MongoDB");

    // Clean up previous test users if any
    const testReferrerEmail = `test_referrer_${Date.now()}@example.com`;
    const testReferredEmail = `test_referred_${Date.now()}@example.com`;

    // 1. Test Referral Code Generation
    console.log("\n--- TEST 1: Referral Code Generation & Uniqueness ---");
    const code1 = await generateUniqueReferralCode("Aashish Sharma");
    assert(typeof code1 === "string" && code1.length >= 6, "Generated valid referral code format");
    assert(code1.startsWith("AA") || code1.startsWith("BM"), "Code correctly uses initials or BM prefix");

    // 2. Create Test Referrer User
    const referrerUser = await User.create({
      name: "Aashish Referrer",
      email: testReferrerEmail,
      password: "Password123#@",
      dateOfBirth: "1998-05-15",
      gender: "Male",
      role: "customer",
      isEmailVerified: true,
      referralCode: code1,
    });
    assert(referrerUser._id != null, "Created test referrer user");

    // 3. Test Active Campaign Retrieval / Seeding
    console.log("\n--- TEST 2: Active Campaign Retrieval ---");
    const campaign = await getActiveCampaign();
    assert(campaign != null && campaign.isActive === true, "Active campaign retrieved or seeded");
    assert(campaign.referrerRewardPoints === 100, "Default referrer reward is 100 points");
    assert(campaign.referredRewardPoints === 50, "Default referred reward is 50 points");

    // 4. Test Referral Code Validation
    console.log("\n--- TEST 3: Referral Code Validation ---");
    const validResult = await validateReferralCode(code1);
    assert(validResult.valid === true, "Valid referral code verified successfully");
    assert(validResult.referrerName.includes("***"), "Referrer name is privacy-masked");

    // Self-referral rejection test
    let selfReferralBlocked = false;
    try {
      await validateReferralCode(code1, referrerUser._id);
    } catch (e) {
      selfReferralBlocked = true;
    }
    assert(selfReferralBlocked, "Self-referral correctly blocked");

    // Invalid code rejection test
    let invalidCodeBlocked = false;
    try {
      await validateReferralCode("INVALID_CODE_999");
    } catch (e) {
      invalidCodeBlocked = true;
    }
    assert(invalidCodeBlocked, "Non-existent code correctly rejected with 404");

    // 5. Create Test Referred User & Attribution
    console.log("\n--- TEST 4: Referral Attribution ---");
    const code2 = await generateUniqueReferralCode("Bikash Customer");
    const referredUser = await User.create({
      name: "Bikash Customer",
      email: testReferredEmail,
      password: "Password123#@",
      dateOfBirth: "2000-08-20",
      gender: "Male",
      role: "customer",
      isEmailVerified: true,
      referralCode: code2,
      referredBy: referrerUser._id,
    });

    const referral = await createReferralAttribution({
      referrerId: referrerUser._id,
      referredId: referredUser._id,
      referralCode: code1,
    });
    assert(referral != null && referral.status === "PENDING", "Referral attribution created with PENDING status");
    assert(referral.referrerReward === 100, "Referral snapshots referrerReward of 100");
    assert(referral.referredReward === 50, "Referral snapshots referredReward of 50");

    // Prevent duplicate attribution for same referred user
    const duplicateAttribution = await createReferralAttribution({
      referrerId: referrerUser._id,
      referredId: referredUser._id,
      referralCode: code1,
    });
    assert(
      duplicateAttribution._id.toString() === referral._id.toString(),
      "Re-attribution safely returns existing referral without creating duplicate"
    );

    // 6. Test Atomic Exactly-Once Reward Processing
    console.log("\n--- TEST 5: Atomic Exactly-Once Reward Processing ---");
    const rewardResult = await processReferralReward({ referralId: referral._id });
    assert(rewardResult.success === true, "Reward processing succeeded");
    assert(rewardResult.alreadyProcessed === false, "First reward execution marked as new");

    // Verify Referrer User Balance
    const updatedReferrer = await User.findById(referrerUser._id);
    assert(updatedReferrer.rewardPoints === 100, "Referrer user credited exactly 100 reward points");

    // Verify Referred User Balance
    const updatedReferred = await User.findById(referredUser._id);
    assert(updatedReferred.rewardPoints === 50, "Referred user credited exactly 50 welcome reward points");

    // Verify Reward Ledger Entries
    const referrerTxn = await RewardTransaction.findOne({
      idempotencyKey: `referral:${referral._id}:referrer`,
    });
    assert(referrerTxn != null && referrerTxn.points === 100, "Referrer ledger transaction created with points = 100");

    const referredTxn = await RewardTransaction.findOne({
      idempotencyKey: `referral:${referral._id}:referred`,
    });
    assert(referredTxn != null && referredTxn.points === 50, "Referred ledger transaction created with points = 50");

    // Verify Referral Status Updated
    const updatedReferral = await Referral.findById(referral._id);
    assert(updatedReferral.status === "REWARDED", "Referral status updated to REWARDED");
    assert(updatedReferral.rewardStatus === "COMPLETED", "Referral rewardStatus updated to COMPLETED");
    assert(updatedReferral.rewardedAt != null, "Referral rewardedAt timestamp recorded");

    // Test Idempotency: Process the same reward again
    console.log("\n--- TEST 6: Duplicate Reward Execution Idempotency ---");
    const secondExecution = await processReferralReward({ referralId: referral._id });
    assert(secondExecution.alreadyProcessed === true, "Duplicate execution returns alreadyProcessed = true");

    const recheckReferrer = await User.findById(referrerUser._id);
    assert(recheckReferrer.rewardPoints === 100, "Referrer points balance NOT doubled on retry (remains 100)");

    const recheckReferred = await User.findById(referredUser._id);
    assert(recheckReferred.rewardPoints === 50, "Referred points balance NOT doubled on retry (remains 50)");

    // 7. Verify In-App Customer Notifications Created
    console.log("\n--- TEST 7: In-App Notifications ---");
    const referrerNotif = await Notification.findOne({
      user: referrerUser._id,
      type: "referral_reward",
    });
    assert(referrerNotif != null, "Referrer notification created");
    assert(referrerNotif.message.includes("100 reward points"), "Referrer notification contains correct points");

    const referredNotif = await Notification.findOne({
      user: referredUser._id,
      type: "welcome_reward",
    });
    assert(referredNotif != null, "Referred welcome notification created");
    assert(referredNotif.message.includes("50 reward points"), "Welcome notification contains correct points");

    // Test mark notification as read
    const readResult = await markNotificationRead(referrerNotif._id, referrerUser._id);
    assert(readResult.isRead === true, "Notification successfully marked as read");

    // 8. Test Authoritative Wallet Summary
    console.log("\n--- TEST 8: Authoritative Wallet Summary ---");
    const walletSummary = await getWalletSummary(referrerUser._id);
    assert(walletSummary.availablePoints === 100, "Authoritative wallet availablePoints is 100");
    assert(walletSummary.lifetimeEarned === 100, "Authoritative wallet lifetimeEarned is 100");
    assert(walletSummary.totalTransactions === 1, "Authoritative wallet totalTransactions is 1");

    // 9. Clean up test users
    console.log("\n--- Cleaning up test artifacts ---");
    await Promise.all([
      User.deleteMany({ _id: { $in: [referrerUser._id, referredUser._id] } }),
      Referral.deleteMany({ _id: referral._id }),
      RewardTransaction.deleteMany({
        idempotencyKey: {
          $in: [
            `referral:${referral._id}:referrer`,
            `referral:${referral._id}:referred`,
          ],
        },
      }),
      Notification.deleteMany({
        user: { $in: [referrerUser._id, referredUser._id] },
      }),
    ]);
    console.log("[DB] Cleaned up temporary test documents");

    console.log("\n==========================================================");
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log("==========================================================");

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Test execution failed with error:", error);
    process.exit(1);
  }
};

runTests();

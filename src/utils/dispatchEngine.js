import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import DispatchSettings from "../models/DispatchSettings.js";
import redisDispatchService, { calculateDistanceKm } from "../services/redisDispatchService.js";
import {
  emitToDeliveryPartner,
  emitToOrderRoom,
  emitStaffAlert,
} from "../socket/socketManager.js";
import { sendPushToDeliveryPartners } from "../services/pushNotificationService.js";
import { createDeliveryNotification } from "../services/deliveryNotificationService.js";

// Re-export calculateDistanceKm
export { calculateDistanceKm };

// Fallback constants
export const TIMEOUT_SECONDS = 20; // Default 20-second quick-commerce offer window
export const RETRY_DELAY_MS = 15000; // 15-second delay when no riders free
export const MAX_DISPATCH_ATTEMPTS = 5;
export const DEFAULT_VENDOR_RADIUS_KM = 5;
export const MAX_SEARCH_DISTANCE_KM = 30;

// In-memory timer registry to clear pending timeouts if order is accepted/cancelled early
const activeOrderTimers = new Map();

/**
 * Generate a cryptographically secure 4-digit OTP
 */
export const generateSecureOTP = () => {
  return crypto.randomInt(1000, 10000).toString();
};

/**
 * Hash an OTP for secure database storage
 */
export const hashOTP = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

/**
 * Verify an incoming plain OTP against stored hash
 */
export const verifyHashedOTP = async (plainOtp, hashedOtp) => {
  if (!plainOtp || !hashedOtp) return false;
  return bcrypt.compare(String(plainOtp).trim(), hashedOtp);
};

/**
 * Multi-factor Weighted Rider Ranking Algorithm
 * Scores rider from 0.0 (worst) to 1.0 (best)
 */
export const calculateRiderScore = ({
  distanceKm,
  etaMinutes,
  activeDeliveriesCount = 0,
  maxActiveOrders = 1,
  locationAgeSeconds = 0,
  rating = 5.0,
  acceptanceRate = 100,
  weights = {},
}) => {
  const wDist = weights.distanceWeight ?? 0.4;
  const wEta = weights.etaWeight ?? 0.25;
  const wWorkload = weights.workloadWeight ?? 0.15;
  const wFreshness = weights.locationFreshnessWeight ?? 0.1;
  const wAcceptance = weights.acceptanceRateWeight ?? 0.1;

  // 1. Distance score: 0 km = 1.0, 15 km = 0.0
  const distanceScore = Math.max(0, 1 - distanceKm / 15);

  // 2. ETA score: 0 mins = 1.0, 30 mins = 0.0
  const etaScore = Math.max(0, 1 - etaMinutes / 30);

  // 3. Workload score: 0 active orders = 1.0, full capacity = 0.0
  const workloadScore = Math.max(0, 1 - activeDeliveriesCount / maxActiveOrders);

  // 4. Freshness score: 0-60s = 1.0, > 900s (15 mins) = 0.0
  const freshnessScore = Math.max(0, 1 - locationAgeSeconds / 900);

  // 5. Performance score: combines 5-star rating and acceptance %
  const normRating = Math.min(1, Math.max(0, (rating || 5) / 5));
  const normAcceptance = Math.min(1, Math.max(0, (acceptanceRate || 100) / 100));
  const performanceScore = normRating * 0.5 + normAcceptance * 0.5;

  const totalScore =
    distanceScore * wDist +
    etaScore * wEta +
    workloadScore * wWorkload +
    freshnessScore * wFreshness +
    performanceScore * wAcceptance;

  return Math.round(totalScore * 1000) / 1000;
};

/**
 * Find and rank eligible delivery partners near pickup store using Redis GEO + MongoDB
 */
export const findEligiblePartners = async ({
  longitude,
  latitude,
  vendorRadiusKm = DEFAULT_VENDOR_RADIUS_KM,
  tier = "PRIORITY_1",
  maxDistanceMeters = null,
  excludePartnerIds = [],
  serviceCity = "",
  scoringWeights = {},
  maxActiveOrders = 1,
}) => {
  const storeLng = Number(longitude);
  const storeLat = Number(latitude);

  let effectiveRadiusKm;
  if (maxDistanceMeters != null && !isNaN(maxDistanceMeters)) {
    effectiveRadiusKm = maxDistanceMeters / 1000;
  } else if (tier === "PRIORITY_1") {
    effectiveRadiusKm = vendorRadiusKm || DEFAULT_VENDOR_RADIUS_KM;
  } else if (tier === "PRIORITY_2_EXPANDED") {
    effectiveRadiusKm = Math.min(
      MAX_SEARCH_DISTANCE_KM,
      Math.max(15, (vendorRadiusKm || DEFAULT_VENDOR_RADIUS_KM) * 2)
    );
  } else {
    effectiveRadiusKm = MAX_SEARCH_DISTANCE_KM;
  }

  const excludeSet = new Set((excludePartnerIds || []).map((id) => id.toString()));

  // 1. First probe Redis for fast available nearby riders
  const redisCandidates = await redisDispatchService.findNearbyAvailableRiders(
    storeLng,
    storeLat,
    effectiveRadiusKm,
    Array.from(excludeSet)
  );

  let rawPartners = [];

  if (redisCandidates.length > 0) {
    const candidateIds = redisCandidates.map((c) => c.riderId);
    const dbPartners = await DeliveryBoy.find({
      _id: { $in: candidateIds },
      approvalStatus: "APPROVED",
      "securityDeposit.status": "PAID",
      availability: { $in: ["ONLINE", "AVAILABLE"] },
      activeOrderId: null,
    });

    const dbMap = new Map(dbPartners.map((p) => [p._id.toString(), p]));

    for (const rc of redisCandidates) {
      const p = dbMap.get(rc.riderId);
      if (p) {
        rawPartners.push({
          partner: p,
          distanceKm: rc.distanceKm,
          locationAgeSeconds: rc.locationAgeSeconds || 0,
        });
      }
    }
  }

  // 2. Fallback to MongoDB 2dsphere / Haversine if Redis has no records or during bootstrap
  if (rawPartners.length === 0) {
    const baseFilter = {
      _id: { $nin: Array.from(excludeSet) },
      approvalStatus: "APPROVED",
      "securityDeposit.status": "PAID",
      availability: "ONLINE",
      activeOrderId: null,
    };

    if (serviceCity) {
      baseFilter.$or = [
        { serviceCity: new RegExp(`^${serviceCity}$`, "i") },
        { serviceCity: "" },
        { serviceCity: null },
      ];
    }

    try {
      const mongoResults = await DeliveryBoy.find({
        ...baseFilter,
        currentLocation: {
          $near: {
            $geometry: { type: "Point", coordinates: [storeLng, storeLat] },
            $maxDistance: effectiveRadiusKm * 1000,
          },
        },
      }).limit(20);

      rawPartners = (mongoResults || []).map((p) => {
        const pLng = Number(p.currentLocation?.coordinates?.[0]) || storeLng;
        const pLat = Number(p.currentLocation?.coordinates?.[1]) || storeLat;
        const distKm = calculateDistanceKm(pLat, pLng, storeLat, storeLng);
        const ageSec = p.lastLocationUpdatedAt
          ? Math.round((Date.now() - new Date(p.lastLocationUpdatedAt).getTime()) / 1000)
          : 300;
        return { partner: p, distanceKm: distKm, locationAgeSeconds: ageSec };
      });
    } catch (err) {
      console.warn("[findEligiblePartners] $near fallback warning:", err.message);
      // Secondary fallback without $near
      const candidates = await DeliveryBoy.find(baseFilter).limit(50);
      rawPartners = (candidates || [])
        .map((p) => {
          const pLng = Number(p.currentLocation?.coordinates?.[0]) || storeLng;
          const pLat = Number(p.currentLocation?.coordinates?.[1]) || storeLat;
          const distKm = calculateDistanceKm(pLat, pLng, storeLat, storeLng);
          const ageSec = p.lastLocationUpdatedAt
            ? Math.round((Date.now() - new Date(p.lastLocationUpdatedAt).getTime()) / 1000)
            : 300;
          return { partner: p, distanceKm: distKm, locationAgeSeconds: ageSec };
        })
        .filter((item) => item.distanceKm <= effectiveRadiusKm);
    }
  }

  // 3. Multi-Factor Scoring & Ranking
  const scoredPartners = rawPartners
    .map(({ partner, distanceKm, locationAgeSeconds }) => {
      // Estimated Time of Arrival: assumes 25 km/h urban average speed + 3 mins buffer
      const etaMinutes = Math.max(2, Math.round((distanceKm / 25) * 60 + 3));

      const score = calculateRiderScore({
        distanceKm,
        etaMinutes,
        activeDeliveriesCount: partner.activeOrderId ? 1 : 0,
        maxActiveOrders,
        locationAgeSeconds,
        rating: partner.metrics?.rating || 5.0,
        acceptanceRate: partner.metrics?.acceptanceRate || 100,
        weights: scoringWeights,
      });

      return {
        partner,
        distanceKm,
        etaMinutes,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

  return scoredPartners.map((item) => item.partner);
};

/**
 * Dispatch an order automatically to the best eligible delivery partner
 */
export const dispatchOrderToNearestPartner = async (orderId, options = {}) => {
  const orderIdStr = orderId.toString();

  // 1. Acquire Redis Distributed Lock for atomic execution
  const lockToken = await redisDispatchService.acquireDispatchLock(orderIdStr, 15);
  if (!lockToken) {
    console.log(
      `[Dispatch Mutex] Dispatch locked for order ${orderIdStr}. Skipping concurrent attempt.`
    );
    return { success: false, message: "Dispatch already in progress" };
  }

  try {
    const order = await Order.findById(orderId).populate("vendor customer");
    if (!order) {
      console.warn(`[Dispatch] Order ${orderId} not found`);
      return { success: false, message: "Order not found" };
    }

    // 2. Verify order is unassigned and in a dispatchable state
    if (order.assignedDeliveryBoy) {
      console.log(`[Dispatch] Order ${order.orderNumber} already has assigned delivery partner`);
      clearOrderDispatchTimer(order._id);
      return { success: false, message: "Order already assigned" };
    }

    if (["DELIVERED", "CANCELLED", "REJECTED"].includes(order.orderStatus)) {
      console.log(`[Dispatch] Order ${order.orderNumber} is ${order.orderStatus}. Stopping dispatch.`);
      clearOrderDispatchTimer(order._id);
      await DeliveryAssignment.updateMany(
        { order: order._id, status: "OFFERED" },
        { $set: { status: "CANCELLED" } }
      );
      return { success: false, message: `Order status is ${order.orderStatus}` };
    }

    // 3. Load active dispatch configuration
    const config = await DispatchSettings.getActiveConfig();
    if (!config.autoDispatchEnabled && !options.force) {
      console.log("[Dispatch] Automatic dispatch is currently disabled by Admin.");
      return { success: false, message: "Auto-dispatch disabled" };
    }

    const offerTimeoutSeconds = config.riderOfferTimeoutSeconds || TIMEOUT_SECONDS;
    const maxAttempts = config.maxDispatchAttempts || MAX_DISPATCH_ATTEMPTS;
    const retryDelayMs = (config.retryDelaySeconds || 15) * 1000;

    // 4. Resolve vendor pickup store coordinates
    const vendor = order.vendor;
    if (!vendor) {
      console.warn(`[Dispatch] Order ${order.orderNumber} has no associated vendor.`);
      return { success: false, message: "Vendor not found for order" };
    }

    let storeLng = 85.324;
    let storeLat = 27.7172;

    if (Array.isArray(vendor?.location?.coordinates) && vendor.location.coordinates.length >= 2) {
      storeLng = Number(vendor.location.coordinates[0]);
      storeLat = Number(vendor.location.coordinates[1]);
    } else if (
      vendor?.shippingLocations?.longitude &&
      vendor?.shippingLocations?.latitude &&
      !isNaN(vendor.shippingLocations.longitude) &&
      !isNaN(vendor.shippingLocations.latitude)
    ) {
      storeLng = Number(vendor.shippingLocations.longitude);
      storeLat = Number(vendor.shippingLocations.latitude);
    }

    const vendorRadiusKm = Math.min(
      config.maxSearchRadiusKm || 50,
      Math.max(
        1,
        Number(vendor.deliveryRadiusKm) || config.initialSearchRadiusKm || DEFAULT_VENDOR_RADIUS_KM
      )
    );

    // 5. Existing DeliveryAssignment check
    let assignment = await DeliveryAssignment.findOne({
      order: order._id,
      vendor: vendor._id,
    }).sort({ createdAt: -1 });

    if (assignment) {
      if (assignment.status === "ACCEPTED" || assignment.status === "COMPLETED") {
        return { success: true, message: "Assignment already accepted", assignment };
      }

      // If active offer is currently pending and unexpired, preserve it
      if (assignment.status === "OFFERED" && assignment.expiresAt > new Date()) {
        const isStillValidInRedis = await redisDispatchService.isOfferActive(
          order._id,
          assignment.deliveryBoy
        );
        if (isStillValidInRedis) {
          console.log(
            `[Dispatch] Order ${order.orderNumber} has active unexpired offer to partner ${assignment.deliveryBoy}`
          );
          return { success: true, message: "Offer currently pending", assignment };
        }
      }

      // If expired, transition to TIMED_OUT
      if (assignment.status === "OFFERED" && assignment.expiresAt <= new Date()) {
        assignment.status = "TIMED_OUT";
        if (
          assignment.deliveryBoy &&
          !assignment.timedOutRiders.some(
            (id) => id.toString() === assignment.deliveryBoy.toString()
          )
        ) {
          assignment.timedOutRiders.push(assignment.deliveryBoy);
        }
        await assignment.save();
      }
    }

    // 6. Check attempt limit & escalation
    const currentAttemptCount = assignment ? assignment.attemptCount || 1 : 1;
    if (currentAttemptCount > maxAttempts) {
      console.warn(
        `[Dispatch Escalation] Order ${order.orderNumber} exceeded ${maxAttempts} attempts without acceptance.`
      );
      if (assignment) {
        assignment.status = "UNASSIGNED_ESCALATED";
        assignment.failureReason = `No rider accepted after ${maxAttempts} automated dispatch attempts.`;
        await assignment.save();
      }

      try {
        emitStaffAlert({
          type: "staff_delivery:unassigned_escalated",
          title: "Delivery Unassigned: Escalated",
          message: `Order #${order.orderNumber} reached max automated retry limit. Requires manual allocation.`,
          data: { orderId: order._id, orderNumber: order.orderNumber, vendorId: vendor._id },
        });
      } catch (_) {}

      return {
        success: false,
        message: `Order exceeded maximum dispatch retry limit (${maxAttempts}). Escalated to operations.`,
      };
    }

    // 7. Exclusions
    const declinedIds = (assignment?.declinedRiders || []).map((id) => id.toString());
    const timedOutIds = (assignment?.timedOutRiders || []).map((id) => id.toString());
    const notifiedIds = (assignment?.notifiedRiders || []).map((id) => id.toString());
    const excludeIds = Array.from(new Set([...declinedIds, ...timedOutIds, ...notifiedIds]));

    const serviceCity = vendor.shippingLocations?.city || order.deliveryAddress?.city || "";

    let eligiblePartners = [];
    let selectedTier = "PRIORITY_1";

    // --- Tier 1: Initial vendor radius ---
    eligiblePartners = await findEligiblePartners({
      longitude: storeLng,
      latitude: storeLat,
      vendorRadiusKm,
      tier: "PRIORITY_1",
      excludePartnerIds: excludeIds,
      serviceCity,
      scoringWeights: config.scoringWeights,
      maxActiveOrders: config.maxActiveOrdersPerRider,
    });

    // --- Tier 2: Expanded radius ---
    if (!eligiblePartners || eligiblePartners.length === 0) {
      selectedTier = "PRIORITY_2_EXPANDED";
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_2_EXPANDED",
        excludePartnerIds: excludeIds,
        serviceCity,
        scoringWeights: config.scoringWeights,
        maxActiveOrders: config.maxActiveOrdersPerRider,
      });
    }

    // --- Tier 3: Maximum search radius ---
    if (!eligiblePartners || eligiblePartners.length === 0) {
      selectedTier = "PRIORITY_3_MAX";
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_3_MAX",
        excludePartnerIds: excludeIds,
        serviceCity,
        scoringWeights: config.scoringWeights,
        maxActiveOrders: config.maxActiveOrdersPerRider,
      });
    }

    // --- Circular Retry: Recycle timed-out riders if whole cycle is exhausted ---
    if (
      (!eligiblePartners || eligiblePartners.length === 0) &&
      (timedOutIds.length > 0 || notifiedIds.length > 0)
    ) {
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_1",
        excludePartnerIds: assignment?.declinedRiders || [],
        serviceCity,
        scoringWeights: config.scoringWeights,
        maxActiveOrders: config.maxActiveOrdersPerRider,
      });
    }

    // 8. Handle when no riders are eligible
    if (!eligiblePartners || eligiblePartners.length === 0) {
      console.log(
        `[Dispatch] No eligible delivery partners available for order ${order.orderNumber}. Scheduling retry in ${retryDelayMs / 1000}s...`
      );

      if (assignment) {
        assignment.nextRetryAt = new Date(Date.now() + retryDelayMs);
        assignment.failureReason = "No eligible delivery partners available nearby";
        await assignment.save();
      } else {
        assignment = await DeliveryAssignment.create({
          order: order._id,
          vendor: vendor._id,
          status: "TIMED_OUT",
          attemptCount: 1,
          maxRetries: maxAttempts,
          failureReason: "No eligible delivery partners available nearby",
          nextRetryAt: new Date(Date.now() + retryDelayMs),
        });
      }

      clearOrderDispatchTimer(order._id);

      const retryTimer = setTimeout(async () => {
        activeOrderTimers.delete(orderIdStr);
        try {
          const freshOrder = await Order.findById(orderId).select(
            "assignedDeliveryBoy orderStatus"
          );
          if (
            freshOrder &&
            !freshOrder.assignedDeliveryBoy &&
            !["DELIVERED", "CANCELLED", "REJECTED"].includes(freshOrder.orderStatus)
          ) {
            console.log(`[Dispatch Retry Timer] Retrying dispatch for order ${freshOrder._id}...`);
            await dispatchOrderToNearestPartner(freshOrder._id);
          }
        } catch (retryErr) {
          console.error("[Dispatch Retry Error]:", retryErr.message);
        }
      }, retryDelayMs);

      activeOrderTimers.set(orderIdStr, retryTimer);

      return {
        success: false,
        message: "No eligible delivery partners available nearby. Scheduled retry.",
      };
    }

    // 9. Best Ranked Candidate
    const candidate = eligiblePartners[0];

    // Compute precise distance and payout from rate card
    const partnerLng = candidate.currentLocation?.coordinates?.[0] || storeLng;
    const partnerLat = candidate.currentLocation?.coordinates?.[1] || storeLat;
    const distanceToStore = calculateDistanceKm(partnerLat, partnerLng, storeLat, storeLng);

    const rateCard = config.payoutRateCard || {};
    const baseFee = rateCard.baseDeliveryFee ?? 40;
    const perKmFee = rateCard.perKmDistanceFee ?? 15;
    const peakPay = rateCard.peakHourIncentive ?? 0;
    const estimatedEarnings = Math.round(baseFee + distanceToStore * perKmFee + peakPay);

    const expiresAt = new Date(Date.now() + offerTimeoutSeconds * 1000);

    // 10. Update or create DeliveryAssignment atomically
    const pickupLoc = {
      address:
        vendor.shippingLocations?.warehouseAddress ||
        vendor.sellerDetails?.address ||
        "Store Warehouse",
      city: vendor.shippingLocations?.city || "Kathmandu",
      coordinates: [storeLng, storeLat],
    };

    const deliveryLoc = {
      address: order.deliveryAddress?.addressLine || "Customer Address",
      city: order.deliveryAddress?.city || "Kathmandu",
      coordinates: [
        Number(order.deliveryAddress?.longitude) || storeLng + 0.01,
        Number(order.deliveryAddress?.latitude) || storeLat + 0.01,
      ],
    };

    if (assignment) {
      assignment.deliveryBoy = candidate._id;
      assignment.status = "OFFERED";
      assignment.offeredAt = new Date();
      assignment.expiresAt = expiresAt;
      assignment.distanceKm = distanceToStore;
      assignment.estimatedEarnings = estimatedEarnings;
      assignment.attemptCount = (assignment.attemptCount || 1) + 1;
      assignment.pickupLocation = pickupLoc;
      assignment.deliveryLocation = deliveryLoc;
      if (!assignment.notifiedRiders) assignment.notifiedRiders = [];
      if (!assignment.notifiedRiders.some((id) => id.toString() === candidate._id.toString())) {
        assignment.notifiedRiders.push(candidate._id);
      }
      if (!assignment.attempts) assignment.attempts = [];
      assignment.attempts.push({
        deliveryBoy: candidate._id,
        offeredAt: new Date(),
        status: "OFFERED",
        distanceKm: distanceToStore,
        searchTier: selectedTier,
      });
      await assignment.save();
    } else {
      assignment = await DeliveryAssignment.create({
        order: order._id,
        deliveryBoy: candidate._id,
        vendor: vendor._id,
        status: "OFFERED",
        attemptCount: 1,
        maxRetries: maxAttempts,
        offeredAt: new Date(),
        expiresAt,
        distanceKm: distanceToStore,
        estimatedEarnings,
        pickupLocation: pickupLoc,
        deliveryLocation: deliveryLoc,
        notifiedRiders: [candidate._id],
        attempts: [
          {
            deliveryBoy: candidate._id,
            offeredAt: new Date(),
            status: "OFFERED",
            distanceKm: distanceToStore,
            searchTier: selectedTier,
          },
        ],
      });
    }

    // 11. Store Active Offer in Redis with TTL
    await redisDispatchService.setDispatchOffer(
      order._id,
      candidate._id,
      offerTimeoutSeconds + 2
    );

    // 12. Generate Cryptographic Pickup & Delivery OTPs if not present
    let orderModified = false;
    if (!order.pickupOtp?.code) {
      const plainPickupOtp = generateSecureOTP();
      const hashedPickupOtp = await hashOTP(plainPickupOtp);
      order.pickupOtp = {
        code: hashedPickupOtp,
        displayCode: plainPickupOtp,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        attempts: 0,
      };
      orderModified = true;
    }

    if (!order.deliveryOtp?.code) {
      const plainDeliveryOtp = generateSecureOTP();
      const hashedDeliveryOtp = await hashOTP(plainDeliveryOtp);
      order.deliveryOtp = {
        code: hashedDeliveryOtp,
        displayCode: plainDeliveryOtp,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        attempts: 0,
      };
      orderModified = true;
    }

    if (orderModified) {
      await order.save();
    }

    // 13. Build real-time offer payload
    const offerPayload = {
      assignmentId: assignment._id.toString(),
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      pickup: {
        storeName: vendor.businessDetails?.businessName || "Bhansamart Partner Store",
        address: assignment.pickupLocation.address,
        distanceKm: distanceToStore,
        coordinates: assignment.pickupLocation.coordinates,
      },
      drop: {
        customerName: order.customer?.name || "Customer",
        address: assignment.deliveryLocation.address,
        coordinates: assignment.deliveryLocation.coordinates,
      },
      partnerLocation: candidate.currentLocation?.coordinates || [partnerLng, partnerLat],
      itemsCount: order.totalCount,
      estimatedEarnings,
      expiresAt: expiresAt.toISOString(),
      timeoutSeconds: offerTimeoutSeconds,
      tier: selectedTier,
    };

    // 14. Emit Real-Time Socket Events
    // Dual emit for legacy "delivery:order:request" and standardized "dispatch:offer"
    emitToDeliveryPartner(
      candidate._id.toString(),
      "delivery:order:request",
      offerPayload,
      candidate.user?.toString()
    );

    emitToDeliveryPartner(
      candidate._id.toString(),
      "dispatch:offer",
      offerPayload,
      candidate.user?.toString()
    );

    // 15. Create Persistent In-App Notification
    await createDeliveryNotification({
      deliveryBoyId: candidate._id,
      userId: candidate.user,
      type: "delivery_request_received",
      title: `New Delivery Request #${order.orderNumber} 🛵`,
      message: `Store ${vendor.businessDetails?.businessName || "Store"} has an order ready. Est. Earning: NPR ${estimatedEarnings}. Accept within ${offerTimeoutSeconds}s.`,
      data: {
        orderId: order._id.toString(),
        assignmentId: assignment._id.toString(),
        orderNumber: order.orderNumber,
        screen: "DeliveryMain",
        estimatedEarnings,
        distanceKm: distanceToStore,
      },
      category: "delivery",
    });

    console.log(
      `[Dispatch Engine] Offered Order #${order.orderNumber} (Attempt ${assignment.attemptCount}, Tier: ${selectedTier}) to Top-Ranked Partner ${candidate.fullName} (${distanceToStore} km away). Expiration in ${offerTimeoutSeconds}s.`
    );

    // 16. Schedule Server-Side Expiration Timer
    clearOrderDispatchTimer(order._id);

    const offerTimeoutTimer = setTimeout(async () => {
      activeOrderTimers.delete(orderIdStr);
      try {
        const timedOutAssignment = await DeliveryAssignment.findOneAndUpdate(
          {
            _id: assignment._id,
            status: "OFFERED",
            deliveryBoy: candidate._id,
            expiresAt: { $lte: new Date(Date.now() + 2000) },
          },
          {
            $set: { status: "TIMED_OUT" },
            $addToSet: { timedOutRiders: candidate._id },
          },
          { returnDocument: "after" }
        );

        if (timedOutAssignment) {
          console.log(
            `[Dispatch Timeout] Offer for order #${order.orderNumber} timed out for partner ${candidate._id} after ${offerTimeoutSeconds}s. Forwarding to next candidate...`
          );

          await DeliveryAssignment.updateOne(
            {
              _id: assignment._id,
              "attempts.deliveryBoy": candidate._id,
              "attempts.status": "OFFERED",
            },
            { $set: { "attempts.$.status": "TIMED_OUT", "attempts.$.respondedAt": new Date() } }
          );

          // Clear Redis offer key
          await redisDispatchService.clearDispatchOffer(order._id, candidate._id);

          // Emit expiration events to rider
          emitToDeliveryPartner(
            candidate._id.toString(),
            "delivery:order:expired",
            {
              assignmentId: assignment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
            },
            candidate.user?.toString()
          );

          emitToDeliveryPartner(
            candidate._id.toString(),
            "dispatch:offer:expired",
            {
              assignmentId: assignment._id,
              orderId: order._id,
              orderNumber: order.orderNumber,
            },
            candidate.user?.toString()
          );

          // Forward automatically to next available partner
          await dispatchOrderToNearestPartner(order._id);
        }
      } catch (timeoutErr) {
        console.error("[Dispatch Timeout Handler Error]:", timeoutErr);
      }
    }, offerTimeoutSeconds * 1000 + 1000);

    activeOrderTimers.set(orderIdStr, offerTimeoutTimer);

    return {
      success: true,
      message: "Order offered to best eligible delivery partner",
      assignmentId: assignment._id,
      deliveryBoyId: candidate._id,
      tier: selectedTier,
    };
  } catch (error) {
    console.error("[dispatchOrderToNearestPartner Error]:", error);
    return { success: false, message: error.message };
  } finally {
    // Release distributed lock
    await redisDispatchService.releaseDispatchLock(orderIdStr, lockToken);
  }
};

/**
 * Clean up active dispatch timer for an order
 */
export const clearOrderDispatchTimer = (orderId) => {
  const orderIdStr = orderId?.toString();
  if (orderIdStr && activeOrderTimers.has(orderIdStr)) {
    clearTimeout(activeOrderTimers.get(orderIdStr));
    activeOrderTimers.delete(orderIdStr);
    console.log(`[Dispatch Engine] Cleared active dispatch timer for order ${orderIdStr}`);
  }
};

/**
 * Server restart recovery: Scan for stale OFFERED assignments and re-dispatch them
 */
export const recoverStaleAssignments = async () => {
  try {
    const staleOffers = await DeliveryAssignment.find({
      status: "OFFERED",
      expiresAt: { $lt: new Date() },
    });

    if (staleOffers.length > 0) {
      console.log(
        `[Dispatch Recovery] Found ${staleOffers.length} stale assignments. Re-dispatching...`
      );
      for (const st of staleOffers) {
        st.status = "TIMED_OUT";
        if (st.deliveryBoy) {
          if (!st.timedOutRiders) st.timedOutRiders = [];
          if (!st.timedOutRiders.some((id) => id.toString() === st.deliveryBoy.toString())) {
            st.timedOutRiders.push(st.deliveryBoy);
          }
        }
        await st.save();
        await dispatchOrderToNearestPartner(st.order).catch((err) =>
          console.warn(`[Recovery Dispatch Error for ${st.order}]:`, err.message)
        );
      }
    }
  } catch (err) {
    console.error("[recoverStaleAssignments Error]:", err.message);
  }
};

export default {
  TIMEOUT_SECONDS,
  RETRY_DELAY_MS,
  MAX_DISPATCH_ATTEMPTS,
  DEFAULT_VENDOR_RADIUS_KM,
  MAX_SEARCH_DISTANCE_KM,
  generateSecureOTP,
  hashOTP,
  verifyHashedOTP,
  calculateDistanceKm,
  calculateRiderScore,
  findEligiblePartners,
  dispatchOrderToNearestPartner,
  dispatchOrder: dispatchOrderToNearestPartner,
  clearOrderDispatchTimer,
  recoverStaleAssignments,
};

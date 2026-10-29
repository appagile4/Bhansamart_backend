import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import {
  emitToDeliveryPartner,
  emitToOrderRoom,
  emitStaffAlert,
} from "../socket/socketManager.js";
import { sendPushToDeliveryPartners } from "../services/pushNotificationService.js";
import { createDeliveryNotification } from "../services/deliveryNotificationService.js";

// Configurable operational limits
export const TIMEOUT_SECONDS = 60; // 60-second acceptance window
export const RETRY_DELAY_MS = 20000; // 20s delay when no riders are currently free
export const MAX_DISPATCH_ATTEMPTS = 5;
export const DEFAULT_VENDOR_RADIUS_KM = 5;
export const MAX_SEARCH_DISTANCE_KM = 30;

// In-memory registry to avoid scheduling duplicate concurrent timers for the same order
const activeOrderTimers = new Map();

// In-memory mutex lock to prevent concurrent duplicate dispatch runs for the same order
const dispatchInProgressLocks = new Set();

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
 * Calculate Haversine distance between two coordinates in kilometers
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Find eligible and available delivery partners near store location
 * Supports progressive radius expansion tiers:
 * - PRIORITY_1: Inside vendor's configured delivery radius (vendor.deliveryRadiusKm || 5 km)
 * - PRIORITY_2_EXPANDED: 2x vendor radius or 15 km, whichever is larger (up to 30 km)
 * - PRIORITY_3_MAX: Up to MAX_SEARCH_DISTANCE_KM (30 km)
 * Candidates are strictly filtered by:
 * - approvalStatus: "APPROVED"
 * - securityDeposit.status: "PAID"
 * - availability: "ONLINE"
 * - activeOrderId: null
 * - serviceCity / serviceArea matching (relaxed if pool exhausted)
 * - Excludes specified partner IDs (declined, timed out, or notified in current cycle)
 * Candidates are sorted nearest-to-furthest from vendor coordinates.
 */
export const findEligiblePartners = async ({
  longitude,
  latitude,
  vendorRadiusKm = DEFAULT_VENDOR_RADIUS_KM,
  tier = "PRIORITY_1",
  maxDistanceMeters = null,
  excludePartnerIds = [],
  serviceCity = "",
}) => {
  const storeLng = Number(longitude);
  const storeLat = Number(latitude);

  // Compute search distance in meters based on tier or explicit parameter
  let effectiveMaxDistanceMeters;
  if (maxDistanceMeters != null && !isNaN(maxDistanceMeters)) {
    effectiveMaxDistanceMeters = Number(maxDistanceMeters);
  } else if (tier === "PRIORITY_1") {
    effectiveMaxDistanceMeters = (vendorRadiusKm || DEFAULT_VENDOR_RADIUS_KM) * 1000;
  } else if (tier === "PRIORITY_2_EXPANDED") {
    const expandedKm = Math.min(
      MAX_SEARCH_DISTANCE_KM,
      Math.max(15, (vendorRadiusKm || DEFAULT_VENDOR_RADIUS_KM) * 2)
    );
    effectiveMaxDistanceMeters = expandedKm * 1000;
  } else {
    // PRIORITY_3_MAX or fallback
    effectiveMaxDistanceMeters = MAX_SEARCH_DISTANCE_KM * 1000;
  }

  const baseFilter = {
    _id: { $nin: excludePartnerIds },
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

  let partners = [];

  // 1. Primary Query: MongoDB 2dsphere $near query (sorted nearest-to-furthest)
  try {
    partners = await DeliveryBoy.find({
      ...baseFilter,
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [storeLng, storeLat],
          },
          $maxDistance: effectiveMaxDistanceMeters,
        },
      },
    }).limit(20);
  } catch (err) {
    console.warn(
      "[findEligiblePartners] $near query warning, falling back to Haversine sort:",
      err.message
    );
  }

  // 2. Fallback / Haversine distance verification:
  // If $near fails or returns empty, query candidates and calculate exact Haversine distance
  if (!partners || partners.length === 0) {
    let candidates = await DeliveryBoy.find(baseFilter).limit(50);
    if (!candidates || candidates.length === 0) {
      // Relax city constraint to avoid dropping orders when city naming differs
      const relaxedFilter = { ...baseFilter };
      delete relaxedFilter.$or;
      candidates = await DeliveryBoy.find(relaxedFilter).limit(50);
    }

    const effectiveMaxKm = effectiveMaxDistanceMeters / 1000;

    partners = (candidates || [])
      .map((p) => {
        const pLng = Number(p.currentLocation?.coordinates?.[0]) || storeLng;
        const pLat = Number(p.currentLocation?.coordinates?.[1]) || storeLat;
        const distKm = calculateDistanceKm(pLat, pLng, storeLat, storeLng);
        return { partner: p, distanceKm: distKm };
      })
      .filter((item) => item.distanceKm <= effectiveMaxKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((item) => item.partner);
  } else {
    // Even when $near succeeded, ensure exact distance sorting
    partners = partners
      .map((p) => {
        const pLng = Number(p.currentLocation?.coordinates?.[0]) || storeLng;
        const pLat = Number(p.currentLocation?.coordinates?.[1]) || storeLat;
        const distKm = calculateDistanceKm(pLat, pLng, storeLat, storeLng);
        return { partner: p, distanceKm: distKm };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((item) => item.partner);
  }

  return partners;
};

/**
 * Dispatch an order to the nearest available delivery boy with automated retry,
 * 60-second acceptance timer orchestration, persistent notification logging,
 * progressive radius expansion, and escalation safeguards.
 */
export const dispatchOrderToNearestPartner = async (orderId, options = {}) => {
  const orderIdStr = orderId.toString();

  // Guard against concurrent duplicate dispatch execution
  if (dispatchInProgressLocks.has(orderIdStr)) {
    console.log(
      `[Dispatch] Dispatch already in progress for order ${orderIdStr}. Skipping concurrent trigger.`
    );
    return { success: false, message: "Dispatch already in progress" };
  }
  dispatchInProgressLocks.add(orderIdStr);

  try {
    const order = await Order.findById(orderId).populate("vendor customer");
    if (!order) {
      console.warn(`[Dispatch] Order ${orderId} not found`);
      return { success: false, message: "Order not found" };
    }

    // 1. Verify delivery is still required and unassigned
    if (order.assignedDeliveryBoy) {
      console.log(`[Dispatch] Order ${order.orderNumber} already has assigned delivery partner`);
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

    // 2. Determine vendor store/warehouse coordinates and delivery radius
    const vendor = order.vendor;
    if (!vendor) {
      console.warn(`[Dispatch] Order ${order.orderNumber} has no associated vendor.`);
      return { success: false, message: "Vendor not found for order" };
    }

    let storeLng = 85.3240;
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
      50,
      Math.max(1, Number(vendor.deliveryRadiusKm) || DEFAULT_VENDOR_RADIUS_KM)
    );

    // Optional: Log customer delivery distance relative to vendor radius
    if (order.deliveryAddress?.longitude && order.deliveryAddress?.latitude) {
      const custDistKm = calculateDistanceKm(
        storeLat,
        storeLng,
        Number(order.deliveryAddress.latitude),
        Number(order.deliveryAddress.longitude)
      );
      console.log(
        `[Dispatch] Order #${order.orderNumber} - Vendor Radius: ${vendorRadiusKm}km, Customer Drop Distance: ${custDistKm}km`
      );
    }

    // 3. Find or reuse existing DeliveryAssignment for this order & vendor
    let assignment = await DeliveryAssignment.findOne({
      order: order._id,
      vendor: vendor._id,
    }).sort({ createdAt: -1 });

    if (assignment) {
      // If already accepted or completed, do nothing
      if (assignment.status === "ACCEPTED" || assignment.status === "COMPLETED") {
        return { success: true, message: "Assignment already accepted", assignment };
      }

      // If active offer is currently running and has not expired, preserve it
      if (assignment.status === "OFFERED" && assignment.expiresAt > new Date()) {
        console.log(
          `[Dispatch] Order ${order.orderNumber} already has active offer to partner ${assignment.deliveryBoy}`
        );
        return { success: true, message: "Offer currently pending", assignment };
      }

      // If active offer has expired, transition it to TIMED_OUT
      if (assignment.status === "OFFERED" && assignment.expiresAt <= new Date()) {
        console.log(
          `[Dispatch] Previous offer for order ${order.orderNumber} expired. Transitioning to TIMED_OUT...`
        );
        assignment.status = "TIMED_OUT";
        if (
          assignment.deliveryBoy &&
          !assignment.timedOutRiders.some((id) => id.toString() === assignment.deliveryBoy.toString())
        ) {
          assignment.timedOutRiders.push(assignment.deliveryBoy);
        }
        await assignment.save();
      }
    }

    // 4. Check escalation and attempt limits
    const currentAttemptCount = assignment ? assignment.attemptCount || 1 : 1;
    if (currentAttemptCount > MAX_DISPATCH_ATTEMPTS) {
      console.warn(
        `[Dispatch Escalation] Order ${order.orderNumber} exceeded ${MAX_DISPATCH_ATTEMPTS} attempts without rider acceptance.`
      );
      if (assignment) {
        assignment.status = "UNASSIGNED_ESCALATED";
        assignment.failureReason = `No rider accepted after ${MAX_DISPATCH_ATTEMPTS} automated dispatch attempts.`;
        await assignment.save();
      }

      // Notify operations staff
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
        message: `Order exceeded maximum dispatch retry limit (${MAX_DISPATCH_ATTEMPTS}). Escalated to operations.`,
      };
    }

    // 5. Progressive Range & Rider Selection
    // Build exclusion list for this round: riders who explicitly declined + riders already timed out/notified in current cycle
    const declinedIds = (assignment?.declinedRiders || []).map((id) => id.toString());
    const timedOutIds = (assignment?.timedOutRiders || []).map((id) => id.toString());
    const notifiedIds = (assignment?.notifiedRiders || []).map((id) => id.toString());

    let excludeIds = Array.from(new Set([...declinedIds, ...timedOutIds, ...notifiedIds]));

    const serviceCity = vendor.shippingLocations?.city || order.deliveryAddress?.city || "";

    let eligiblePartners = [];
    let selectedTier = "PRIORITY_1";

    // --- Tier 1: Search within vendor's configured delivery radius ---
    eligiblePartners = await findEligiblePartners({
      longitude: storeLng,
      latitude: storeLat,
      vendorRadiusKm,
      tier: "PRIORITY_1",
      excludePartnerIds: excludeIds,
      serviceCity,
    });

    // --- Tier 2: Expand search to nearby eligible riders outside primary radius ---
    if (!eligiblePartners || eligiblePartners.length === 0) {
      selectedTier = "PRIORITY_2_EXPANDED";
      console.log(
        `[Dispatch] Priority 1 range (${vendorRadiusKm}km) exhausted for order ${order.orderNumber}. Expanding to Priority 2...`
      );
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_2_EXPANDED",
        excludePartnerIds: excludeIds,
        serviceCity,
      });
    }

    // --- Tier 3: Expand search to max delivery radius (30 km) ---
    if (!eligiblePartners || eligiblePartners.length === 0) {
      selectedTier = "PRIORITY_3_MAX";
      console.log(
        `[Dispatch] Priority 2 range exhausted for order ${order.orderNumber}. Expanding to Priority 3 (Max ${MAX_SEARCH_DISTANCE_KM}km)...`
      );
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_3_MAX",
        excludePartnerIds: excludeIds,
        serviceCity,
      });
    }

    // --- Circular Retry: If all riders in current cycle have been tried, check newly free or re-available riders ---
    // (Still exclude riders who explicitly declined)
    if (
      (!eligiblePartners || eligiblePartners.length === 0) &&
      (timedOutIds.length > 0 || notifiedIds.length > 0)
    ) {
      console.log(
        `[Dispatch] Cycle exhausted for order ${order.orderNumber}. Checking newly free or re-available riders (excluding explicit declines)...`
      );

      // Try Priority 1 again for newly online/free riders
      eligiblePartners = await findEligiblePartners({
        longitude: storeLng,
        latitude: storeLat,
        vendorRadiusKm,
        tier: "PRIORITY_1",
        excludePartnerIds: assignment?.declinedRiders || [],
        serviceCity,
      });

      if (!eligiblePartners || eligiblePartners.length === 0) {
        selectedTier = "PRIORITY_2_EXPANDED";
        eligiblePartners = await findEligiblePartners({
          longitude: storeLng,
          latitude: storeLat,
          vendorRadiusKm,
          tier: "PRIORITY_2_EXPANDED",
          excludePartnerIds: assignment?.declinedRiders || [],
          serviceCity,
        });
      }

      if (!eligiblePartners || eligiblePartners.length === 0) {
        selectedTier = "PRIORITY_3_MAX";
        eligiblePartners = await findEligiblePartners({
          longitude: storeLng,
          latitude: storeLat,
          vendorRadiusKm,
          tier: "PRIORITY_3_MAX",
          excludePartnerIds: assignment?.declinedRiders || [],
          serviceCity,
        });
      }
    }

    // 6. Handle case where no eligible riders are currently available
    if (!eligiblePartners || eligiblePartners.length === 0) {
      console.log(
        `[Dispatch] No eligible delivery partners currently available for order ${order.orderNumber}. Scheduling controlled retry in ${RETRY_DELAY_MS / 1000}s...`
      );

      if (assignment) {
        assignment.nextRetryAt = new Date(Date.now() + RETRY_DELAY_MS);
        assignment.failureReason = "No eligible delivery partners available nearby";
        await assignment.save();
      } else {
        assignment = await DeliveryAssignment.create({
          order: order._id,
          vendor: vendor._id,
          status: "TIMED_OUT",
          attemptCount: 1,
          maxRetries: MAX_DISPATCH_ATTEMPTS,
          failureReason: "No eligible delivery partners available nearby",
          nextRetryAt: new Date(Date.now() + RETRY_DELAY_MS),
        });
      }

      // Schedule controlled background retry (clear previous retry timer if any)
      if (activeOrderTimers.has(orderIdStr)) {
        clearTimeout(activeOrderTimers.get(orderIdStr));
      }

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
            console.log(
              `[Dispatch Retry Timer] Retrying dispatch for order ${freshOrder._id}...`
            );
            await dispatchOrderToNearestPartner(freshOrder._id);
          }
        } catch (retryErr) {
          console.error("[Dispatch Retry Execution Error]:", retryErr.message);
        }
      }, RETRY_DELAY_MS);

      activeOrderTimers.set(orderIdStr, retryTimer);

      return {
        success: false,
        message:
          "No eligible delivery partners available nearby. System scheduled controlled retry.",
      };
    }

    // 7. Pick nearest candidate
    const candidate = eligiblePartners[0];

    const partnerLng = candidate.currentLocation?.coordinates?.[0] || storeLng;
    const partnerLat = candidate.currentLocation?.coordinates?.[1] || storeLat;
    const distanceToStore = calculateDistanceKm(partnerLat, partnerLng, storeLat, storeLng);
    const estimatedEarnings = 40 + Math.round(distanceToStore * 15); // Base ₹40 + ₹15/km

    const expiresAt = new Date(Date.now() + TIMEOUT_SECONDS * 1000);

    // 8. Create or update DeliveryAssignment atomically
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
        maxRetries: MAX_DISPATCH_ATTEMPTS,
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

    // 9. Ensure Cryptographic OTPs are generated on Order
    if (!order.pickupOtp?.code) {
      const plainPickupOtp = generateSecureOTP();
      const hashedPickupOtp = await hashOTP(plainPickupOtp);
      order.pickupOtp = {
        code: hashedPickupOtp,
        displayCode: plainPickupOtp,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        attempts: 0,
      };
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
    }

    await order.save();

    // 10. Prepare socket offer payload
    const offerPayload = {
      assignmentId: assignment._id,
      orderId: order._id,
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
      expiresAt,
      timeoutSeconds: TIMEOUT_SECONDS,
      tier: selectedTier,
    };

    // 11. Real-Time Socket Emission
    emitToDeliveryPartner(
      candidate._id.toString(),
      "delivery:order:request",
      offerPayload,
      candidate.user?.toString()
    );

    // 12. Persistent Notification in Delivery Boy In-App Notifications Feed
    await createDeliveryNotification({
      deliveryBoyId: candidate._id,
      userId: candidate.user,
      type: "delivery_request_received",
      title: `New Delivery Request #${order.orderNumber} 🛵`,
      message: `Store ${vendor.businessDetails?.businessName || "Store"} has an order ready. Est. Earning: NPR ${estimatedEarnings}. Accept within ${TIMEOUT_SECONDS}s.`,
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
      `[Dispatch] Offered Order ${order.orderNumber} (Attempt ${assignment.attemptCount}, Tier: ${selectedTier}) to Nearest Partner ${candidate.fullName} (${candidate._id}, ${distanceToStore} km away). Timeout in ${TIMEOUT_SECONDS}s.`
    );

    // 13. Schedule server-side timeout handler (60s + 1s leeway)
    if (activeOrderTimers.has(orderIdStr)) {
      clearTimeout(activeOrderTimers.get(orderIdStr));
    }

    const offerTimeoutTimer = setTimeout(async () => {
      activeOrderTimers.delete(orderIdStr);
      try {
        const timedOutAssignment = await DeliveryAssignment.findOneAndUpdate(
          {
            _id: assignment._id,
            status: "OFFERED",
            deliveryBoy: candidate._id,
            expiresAt: { $lte: new Date(Date.now() + 2000) }, // leeway
          },
          {
            $set: { status: "TIMED_OUT" },
            $addToSet: { timedOutRiders: candidate._id },
          },
          { new: true }
        );

        if (timedOutAssignment) {
          console.log(
            `[Dispatch Timeout] Assignment ${assignment._id} timed out for partner ${candidate._id} after ${TIMEOUT_SECONDS}s. Forwarding to next candidate...`
          );

          // Update attempt status in attempts array
          await DeliveryAssignment.updateOne(
            {
              _id: assignment._id,
              "attempts.deliveryBoy": candidate._id,
              "attempts.status": "OFFERED",
            },
            { $set: { "attempts.$.status": "TIMED_OUT", "attempts.$.respondedAt": new Date() } }
          );

          // Emit expired event to rider
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

          // Create persistent notification for expiry
          await createDeliveryNotification({
            deliveryBoyId: candidate._id,
            userId: candidate.user,
            type: "delivery_request_expired",
            title: `Delivery Offer Expired: #${order.orderNumber}`,
            message: `The ${TIMEOUT_SECONDS}s offer window for order #${order.orderNumber} expired and was forwarded to another partner.`,
            data: {
              orderId: order._id.toString(),
              assignmentId: assignment._id.toString(),
              orderNumber: order.orderNumber,
            },
            category: "delivery",
          });

          // Forward to next candidate
          await dispatchOrderToNearestPartner(order._id);
        }
      } catch (timeoutErr) {
        console.error("[Dispatch Timeout Handler Error]:", timeoutErr);
      }
    }, TIMEOUT_SECONDS * 1000 + 1000);

    activeOrderTimers.set(orderIdStr, offerTimeoutTimer);

    return {
      success: true,
      message: "Order offered to nearest delivery partner",
      assignmentId: assignment._id,
      deliveryBoyId: candidate._id,
      tier: selectedTier,
    };
  } catch (error) {
    console.error("[dispatchOrderToNearestPartner Error]:", error);
    return { success: false, message: error.message };
  } finally {
    dispatchInProgressLocks.delete(orderIdStr);
  }
};

/**
 * Clean up active dispatch timer for an order (e.g. when order is accepted or cancelled)
 */
export const clearOrderDispatchTimer = (orderId) => {
  const orderIdStr = orderId?.toString();
  if (orderIdStr && activeOrderTimers.has(orderIdStr)) {
    clearTimeout(activeOrderTimers.get(orderIdStr));
    activeOrderTimers.delete(orderIdStr);
    console.log(`[Dispatch] Cleared active dispatch timer for order ${orderIdStr}`);
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
  findEligiblePartners,
  dispatchOrderToNearestPartner,
  clearOrderDispatchTimer,
  recoverStaleAssignments,
};

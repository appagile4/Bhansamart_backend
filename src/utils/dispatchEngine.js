import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import { emitToDeliveryPartner, emitToOrderRoom } from "../socket/socketManager.js";
import { sendPushToDeliveryPartners } from "../services/pushNotificationService.js";

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
 * Priority: Nearest available partner to the vendor's house / warehouse coordinates
 */
export const findEligiblePartners = async ({
  longitude,
  latitude,
  maxDistanceMeters = 25000, // 25 km primary radius
  excludePartnerIds = [],
}) => {
  const storeLng = Number(longitude);
  const storeLat = Number(latitude);

  const baseFilter = {
    _id: { $nin: excludePartnerIds },
    approvalStatus: "APPROVED",
    "securityDeposit.status": "PAID",
    availability: "ONLINE",
    activeOrderId: null,
  };

  let partners = [];

  // 1. Primary Query: MongoDB 2dsphere $near query (automatically returns candidates sorted nearest-to-furthest)
  try {
    partners = await DeliveryBoy.find({
      ...baseFilter,
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [storeLng, storeLat],
          },
          $maxDistance: maxDistanceMeters,
        },
      },
    }).limit(10);
  } catch (err) {
    console.warn("[findEligiblePartners] $near query warning, falling back to Haversine sort:", err.message);
  }

  // 2. Fallback / Extended Query: If no partners in primary radius, find all active online partners
  // and sort them strictly by exact Haversine distance from the vendor's location
  if (!partners || partners.length === 0) {
    const candidates = await DeliveryBoy.find(baseFilter).limit(50);
    partners = candidates
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
 * Dispatch an order to the nearest available delivery boy
 */
export const dispatchOrderToNearestPartner = async (orderId) => {
  try {
    const order = await Order.findById(orderId).populate("vendor customer");
    if (!order) {
      console.warn(`[Dispatch] Order ${orderId} not found`);
      return { success: false, message: "Order not found" };
    }

    // Do not re-dispatch if already assigned or completed/cancelled
    if (order.assignedDeliveryBoy) {
      console.log(`[Dispatch] Order ${order.orderNumber} already has assigned delivery partner`);
      return { success: false, message: "Order already assigned" };
    }

    if (["DELIVERED", "CANCELLED", "REJECTED"].includes(order.orderStatus)) {
      return { success: false, message: `Order status is ${order.orderStatus}` };
    }

    // Determine vendor store/warehouse coordinates
    const vendor = order.vendor;
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

    // Find previous rejections or timeouts for this order to avoid offering repeatedly
    const existingAssignments = await DeliveryAssignment.find({
      order: order._id,
      status: { $in: ["REJECTED", "TIMED_OUT", "CANCELLED"] },
    }).select("deliveryBoy");

    const excludeIds = existingAssignments.map((a) => a.deliveryBoy);

    // Also exclude any delivery partner currently with an active OFFERED assignment for this order
    const pendingOffer = await DeliveryAssignment.findOne({
      order: order._id,
      status: "OFFERED",
      expiresAt: { $gt: new Date() },
    });

    if (pendingOffer) {
      console.log(`[Dispatch] Order ${order.orderNumber} already has active offer to partner ${pendingOffer.deliveryBoy}`);
      return { success: true, message: "Offer already pending", assignment: pendingOffer };
    }

    const eligiblePartners = await findEligiblePartners({
      longitude: storeLng,
      latitude: storeLat,
      maxDistanceMeters: 25000,
      excludePartnerIds: excludeIds,
    });

    if (!eligiblePartners || eligiblePartners.length === 0) {
      console.log(`[Dispatch] No eligible delivery partners found for order ${order.orderNumber}`);
      return {
        success: false,
        message: "No eligible delivery partners available nearby. System will retry.",
      };
    }

    // Nearest partner to the vendor house is index 0
    const candidate = eligiblePartners[0];

    // Calculate distance and estimated earnings
    const partnerLng = candidate.currentLocation?.coordinates?.[0] || storeLng;
    const partnerLat = candidate.currentLocation?.coordinates?.[1] || storeLat;
    const distanceToStore = calculateDistanceKm(partnerLat, partnerLng, storeLat, storeLng);
    const estimatedEarnings = 40 + Math.round(distanceToStore * 15); // Base ₹40 + ₹15/km

    const timeoutSeconds = 45;
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

    // Create assignment offer record
    const assignment = await DeliveryAssignment.create({
      order: order._id,
      deliveryBoy: candidate._id,
      vendor: vendor._id,
      status: "OFFERED",
      offeredAt: new Date(),
      expiresAt,
      distanceKm: distanceToStore,
      estimatedEarnings,
      pickupLocation: {
        address:
          vendor.shippingLocations?.warehouseAddress ||
          vendor.sellerDetails?.address ||
          "Store Warehouse",
        city: vendor.shippingLocations?.city || "Kathmandu",
        coordinates: [storeLng, storeLat],
      },
      deliveryLocation: {
        address: order.deliveryAddress?.addressLine || "Customer Address",
        city: order.deliveryAddress?.city || "Kathmandu",
        coordinates: [storeLng + 0.01, storeLat + 0.01],
      },
    });

    // Generate cryptographically secure OTPs for the order if not already generated
    if (!order.pickupOtp?.code) {
      const plainPickupOtp = generateSecureOTP();
      const hashedPickupOtp = await hashOTP(plainPickupOtp);
      order.pickupOtp = {
        code: hashedPickupOtp,
        displayCode: plainPickupOtp, // Retained for vendor handover screen
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours validity
        attempts: 0,
      };
    }

    if (!order.deliveryOtp?.code) {
      const plainDeliveryOtp = generateSecureOTP();
      const hashedDeliveryOtp = await hashOTP(plainDeliveryOtp);
      order.deliveryOtp = {
        code: hashedDeliveryOtp,
        displayCode: plainDeliveryOtp, // Retained for customer verification screen
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours validity
        attempts: 0,
      };
    }

    await order.save();

    // Prepare socket offer payload
    const offerPayload = {
      assignmentId: assignment._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      pickup: {
        storeName: vendor.businessDetails?.businessName || "Grocery Store",
        address: assignment.pickupLocation.address,
        distanceKm: distanceToStore,
        coordinates: assignment.pickupLocation.coordinates, // [longitude, latitude]
      },
      drop: {
        customerName: order.customer?.name || "Customer",
        address: assignment.deliveryLocation.address,
        coordinates: assignment.deliveryLocation.coordinates, // [longitude, latitude]
      },
      partnerLocation: candidate.currentLocation?.coordinates || [partnerLng, partnerLat],
      itemsCount: order.totalCount,
      estimatedEarnings,
      expiresAt,
      timeoutSeconds,
    };

    // Emit real-time offer to candidate's socket rooms (delivery room and user room)
    emitToDeliveryPartner(
      candidate._id.toString(),
      "delivery:order:request",
      offerPayload,
      candidate.user?.toString()
    );

    sendPushToDeliveryPartners({
      deliveryBoyIds: [candidate._id],
      title: "New Delivery Offer Nearby! 🛵",
      body: `Order #${order.orderNumber} is ready for delivery. Est. Earnings: NPR ${assignment.estimatedEarnings || 60}.`,
      data: {
        orderId: order._id.toString(),
        assignmentId: assignment._id.toString(),
        screen: "DeliveryTaskScreen",
        type: "DELIVERY_OFFER",
      },
      channelId: "delivery",
      priority: "high",
    }).catch(() => {});
    console.log(
      `[Dispatch] Offered Order ${order.orderNumber} to Nearest Delivery Partner ${candidate.fullName} (${candidate._id}, ${distanceToStore} km away). Timeout in ${timeoutSeconds}s.`
    );

    // Schedule automated offer expiry check
    setTimeout(async () => {
      try {
        const checkAssignment = await DeliveryAssignment.findById(assignment._id);
        if (checkAssignment && checkAssignment.status === "OFFERED") {
          checkAssignment.status = "TIMED_OUT";
          await checkAssignment.save();
          console.log(
            `[Dispatch] Assignment ${assignment._id} timed out for partner ${candidate._id}. Re-dispatching...`
          );

          // Attempt next candidate
          await dispatchOrderToNearestPartner(order._id);
        }
      } catch (timeoutErr) {
        console.error("[Dispatch Timeout Handler Error]:", timeoutErr);
      }
    }, timeoutSeconds * 1000 + 1000);

    return {
      success: true,
      message: "Order offered to nearest delivery partner",
      assignmentId: assignment._id,
      deliveryBoyId: candidate._id,
    };
  } catch (error) {
    console.error("[dispatchOrderToNearestPartner Error]:", error);
    return { success: false, message: error.message };
  }
};

import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import Order from "../models/Order.js";
import Vendor from "../models/Vendor.js";
import { emitToDeliveryPartner, emitToOrderRoom } from "../socket/socketManager.js";

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
 */
export const findEligiblePartners = async ({
  longitude,
  latitude,
  maxDistanceMeters = 10000, // 10 km
  excludePartnerIds = [],
}) => {
  const freshThreshold = new Date(Date.now() - 30 * 60 * 1000); // Updated within 30 min

  const query = {
    _id: { $nin: excludePartnerIds },
    approvalStatus: "APPROVED",
    "securityDeposit.status": "PAID",
    availability: "ONLINE",
    activeOrderId: null,
    "documents.panCard.status": "VERIFIED",
    "documents.aadhaarCard.status": "VERIFIED",
    "documents.drivingLicense.status": "VERIFIED",
    "documents.vehicleRc.status": "VERIFIED",
    lastLocationUpdatedAt: { $gte: freshThreshold },
    currentLocation: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        $maxDistance: maxDistanceMeters,
      },
    },
  };

  try {
    return await DeliveryBoy.find(query).limit(5);
  } catch (err) {
    // Fallback if 2dsphere index query fails or testing without geospatial index
    console.warn("[findEligiblePartners] Geospatial query warning, using in-memory distance fallback:", err.message);
    const candidateQuery = {
      _id: { $nin: excludePartnerIds },
      approvalStatus: "APPROVED",
      "securityDeposit.status": "PAID",
      availability: "ONLINE",
      activeOrderId: null,
      "documents.panCard.status": "VERIFIED",
      "documents.aadhaarCard.status": "VERIFIED",
      "documents.drivingLicense.status": "VERIFIED",
      "documents.vehicleRc.status": "VERIFIED",
    };
    return await DeliveryBoy.find(candidateQuery).limit(5);
  }
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

    // Determine vendor store coordinates
    const vendor = order.vendor;
    const storeLng =
      vendor?.shippingLocations?.longitude && !isNaN(vendor.shippingLocations.longitude)
        ? Number(vendor.shippingLocations.longitude)
        : 85.3240;
    const storeLat =
      vendor?.shippingLocations?.latitude && !isNaN(vendor.shippingLocations.latitude)
        ? Number(vendor.shippingLocations.latitude)
        : 27.7172;

    // Find previous rejections or timeouts for this order to avoid offering repeatedly
    const existingAssignments = await DeliveryAssignment.find({
      order: order._id,
      status: { $in: ["REJECTED", "TIMED_OUT"] },
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
      maxDistanceMeters: 10000,
      excludePartnerIds: excludeIds,
    });

    if (!eligiblePartners || eligiblePartners.length === 0) {
      console.log(`[Dispatch] No eligible delivery partners found for order ${order.orderNumber}`);
      return {
        success: false,
        message: "No eligible delivery partners available nearby. System will retry.",
      };
    }

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
      },
      drop: {
        customerName: order.customer?.name || "Customer",
        address: assignment.deliveryLocation.address,
      },
      itemsCount: order.totalCount,
      estimatedEarnings,
      expiresAt,
      timeoutSeconds,
    };

    // Emit real-time offer to candidate's socket rooms
    emitToDeliveryPartner(candidate._id.toString(), "delivery:order:request", offerPayload);
    console.log(
      `[Dispatch] Offered Order ${order.orderNumber} to Delivery Partner ${candidate.fullName} (${candidate._id}). Timeout in ${timeoutSeconds}s.`
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

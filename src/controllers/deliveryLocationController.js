import DeliveryBoy from "../models/DeliveryBoy.js";
import Order from "../models/Order.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { emitDeliveryLocationUpdate, emitToOrderRoom } from "../socket/socketManager.js";

/**
 * Toggle Delivery Partner Availability (ONLINE / OFFLINE)
 * PATCH /api/delivery/availability/toggle
 */
export const toggleAvailability = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { status } = req.body; // "ONLINE" or "OFFLINE"

    if (status && !["ONLINE", "OFFLINE"].includes(status)) {
      return next(new AppError("Availability status must be either ONLINE or OFFLINE", 400));
    }

    const targetStatus = status || (deliveryBoy.availability === "ONLINE" ? "OFFLINE" : "ONLINE");

    if (targetStatus === "ONLINE") {
      // Validate all prerequisites before allowing partner to go ONLINE
      if (deliveryBoy.approvalStatus !== "APPROVED") {
        return next(
          new AppError(
            `Cannot go online. Account status is '${deliveryBoy.approvalStatus}'. Approval by admin is required.`,
            403
          )
        );
      }

      if (deliveryBoy.securityDeposit?.status !== "PAID") {
        return next(
          new AppError(
            "Cannot go online. ₹1,000 security deposit must be paid first.",
            403
          )
        );
      }

      if (!deliveryBoy.areAllDocumentsVerified()) {
        return next(
          new AppError(
            "Cannot go online. All 4 mandatory documents (PAN, Aadhaar, Driving License, RC) must be verified.",
            403
          )
        );
      }

      deliveryBoy.availability = "ONLINE";
      deliveryBoy.lastLocationUpdatedAt = new Date();
    } else {
      // Trying to go OFFLINE
      if (deliveryBoy.activeOrderId) {
        return next(
          new AppError(
            "Cannot go offline while fulfilling an active delivery order.",
            400
          )
        );
      }

      deliveryBoy.availability = "OFFLINE";
    }

    await deliveryBoy.save();

    res.status(200).json({
      success: true,
      message: `Partner is now ${deliveryBoy.availability}`,
      availability: deliveryBoy.availability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current availability status
 * GET /api/delivery/availability/status
 */
export const getAvailabilityStatus = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    res.status(200).json({
      success: true,
      availability: deliveryBoy.availability,
      canGoOnline: deliveryBoy.canGoOnline(),
      activeOrderId: deliveryBoy.activeOrderId,
      approvalStatus: deliveryBoy.approvalStatus,
      depositStatus: deliveryBoy.securityDeposit?.status,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update GPS Location via REST endpoint
 * POST /api/delivery/location/update
 */
export const updateGpsLocation = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const { latitude, longitude, heading = 0, speed = 0 } = req.body;

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return next(new AppError("Valid latitude and longitude numbers are required", 400));
    }

    const now = new Date();

    // 1. Update partner location
    deliveryBoy.currentLocation = {
      type: "Point",
      coordinates: [lng, lat],
    };
    deliveryBoy.lastLocationUpdatedAt = now;
    await deliveryBoy.save();

    // 2. If partner is actively fulfilling an order, sync coordinates and broadcast to order room
    if (deliveryBoy.activeOrderId) {
      await Order.findByIdAndUpdate(deliveryBoy.activeOrderId, {
        $set: {
          deliveryBoyLocation: {
            type: "Point",
            coordinates: [lng, lat],
            updatedAt: now,
          },
        },
      });

      emitDeliveryLocationUpdate(deliveryBoy.activeOrderId.toString(), {
        orderId: deliveryBoy.activeOrderId,
        deliveryBoyId: deliveryBoy._id,
        latitude: lat,
        longitude: lng,
        heading,
        speed,
        updatedAt: now,
      });
    }

    res.status(200).json({
      success: true,
      message: "GPS location updated successfully",
      coordinates: [lng, lat],
      updatedAt: now,
    });
  } catch (error) {
    next(error);
  }
};

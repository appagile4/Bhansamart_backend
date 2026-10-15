import Vendor from "../models/Vendor.js";
import User from "../models/User.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import {
  emitDeliveryRadiusUpdated,
  emitVendorAvailabilityChanged,
} from "../socket/socketManager.js";
import { calculateDistanceKm } from "../utils/dispatchEngine.js";

/**
 * @desc    Get current authenticated vendor data
 * @route   GET /api/vendor/profile
 * @access  Private (Vendor)
 */
export const getMyVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id }).populate(
      "userId",
      "name email phone avatar role status"
    );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: vendor,
    });
  } catch (error) {
    console.error("[Get My Vendor Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch vendor profile.",
    });
  }
};

/**
 * @desc    Update a specific vendor section (businessDetails, sellerDetails, brandDetails, bankDetails, shippingLocations)
 * @route   PUT /api/vendor/update-section
 * @access  Private (Vendor)
 */
export const updateVendorSection = async (req, res) => {
  try {
    const { section, data } = req.body;
    const userId = req.user._id;

    if (!section || !data) {
      return res.status(400).json({
        success: false,
        message: "Section name and data are required.",
      });
    }

    const allowedSections = [
      "businessDetails",
      "sellerDetails",
      "brandDetails",
      "bankDetails",
      "shippingLocations",
    ];

    if (!allowedSections.includes(section)) {
      return res.status(400).json({
        success: false,
        message: `Invalid section. Allowed sections: ${allowedSections.join(", ")}`,
      });
    }

    const setPayload = {};
    Object.keys(data).forEach((key) => {
      setPayload[`${section}.${key}`] = data[key];
    });

    if (
      section === "shippingLocations" &&
      data.longitude != null &&
      data.latitude != null &&
      !isNaN(data.longitude) &&
      !isNaN(data.latitude)
    ) {
      setPayload["location"] = {
        type: "Point",
        coordinates: [Number(data.longitude), Number(data.latitude)],
      };
    }

    const vendor = await Vendor.findOneAndUpdate(
      { userId },
      { $set: setPayload },
      { returnDocument: "after", runValidators: false }
    );

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${section} updated successfully.`,
      data: vendor,
    });
  } catch (error) {
    console.error("[Update Vendor Section Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update vendor section.",
    });
  }
};

/**
 * @desc    Upload Vendor Brand Logo
 * @route   POST /api/vendor/upload-logo
 * @access  Private (Vendor)
 */
export const uploadVendorLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a logo image to upload.",
      });
    }

    const userId = req.user._id;
    const vendor = await Vendor.findOne({ userId });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    // If existing logo has a publicId, delete old logo from Cloudinary
    if (vendor.brandDetails?.brandLogoPublicId) {
      await deleteFromCloudinary(vendor.brandDetails.brandLogoPublicId);
    }

    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      "bhansamart/vendor/logos",
      500,
      500
    );

    vendor.brandDetails.brandLogo = uploadResult.secure_url;
    vendor.brandDetails.brandLogoPublicId = uploadResult.public_id;
    await vendor.save();

    return res.status(200).json({
      success: true,
      message: "Vendor logo uploaded successfully.",
      logoUrl: uploadResult.secure_url,
      data: vendor,
    });
  } catch (error) {
    console.error("[Upload Vendor Logo Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to upload vendor logo.",
    });
  }
};

/**
 * @desc    Get all approved vendors (Public list for customers)
 * @route   GET /api/vendor/approved
 * @access  Public
 */
export const getApprovedVendors = async (req, res) => {
  try {
    const vendors = await Vendor.find({ status: { $in: ["approved", "active"] } })
      .populate("userId", "name email phone avatar")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: vendors.length,
      data: vendors,
    });
  } catch (error) {
    console.error("[Get Approved Vendors Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch vendors.",
    });
  }
};

/**
 * @desc    Update Vendor Delivery Radius
 * @route   PUT /api/vendor/delivery-radius
 * @access  Private (Vendor)
 */
export const updateDeliveryRadius = async (req, res) => {
  try {
    const { deliveryRadiusKm } = req.body;
    const radiusNum = parseFloat(deliveryRadiusKm);

    if (isNaN(radiusNum) || radiusNum < 1 || radiusNum > 50) {
      return res.status(400).json({
        success: false,
        message: "Delivery radius must be a valid number between 1 km and 50 km.",
      });
    }

    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    vendor.deliveryRadiusKm = Math.round(radiusNum * 10) / 10;
    await vendor.save();

    // Broadcast delivery radius change via Socket.IO
    emitDeliveryRadiusUpdated(
      vendor._id,
      vendor.deliveryRadiusKm,
      vendor.businessDetails?.businessName || ""
    );

    return res.status(200).json({
      success: true,
      message: `Delivery radius successfully updated to ${vendor.deliveryRadiusKm} km.`,
      deliveryRadiusKm: vendor.deliveryRadiusKm,
      data: vendor,
    });
  } catch (error) {
    console.error("[Update Delivery Radius Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update delivery radius.",
    });
  }
};

/**
 * @desc    Toggle or set Vendor Store Open/Closed Status
 * @route   PUT /api/vendor/store-status
 * @access  Private (Vendor)
 */
export const updateStoreStatus = async (req, res) => {
  try {
    const { isStoreOpen } = req.body;
    if (typeof isStoreOpen !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Field 'isStoreOpen' must be a boolean (true or false).",
      });
    }

    const vendor = await Vendor.findOne({ userId: req.user._id });
    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    vendor.isStoreOpen = isStoreOpen;
    await vendor.save();

    // Broadcast store availability update via Socket.IO
    emitVendorAvailabilityChanged(
      vendor._id,
      vendor.isStoreOpen,
      vendor.businessDetails?.businessName || ""
    );

    return res.status(200).json({
      success: true,
      message: `Store status updated to ${isStoreOpen ? "Open" : "Closed"}.`,
      isStoreOpen: vendor.isStoreOpen,
      data: vendor,
    });
  } catch (error) {
    console.error("[Update Store Status Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update store status.",
    });
  }
};

/**
 * @desc    Get nearby active & open vendors for customer coordinates
 * @route   GET /api/vendor/nearby
 * @access  Public
 */
export const getNearbyVendors = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat || req.query.latitude);
    const lng = parseFloat(req.query.lng || req.query.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude coordinates are required.",
      });
    }

    const showAll =
      req.query.all === "true" ||
      req.query.includeAll === "true" ||
      req.query.allStores === "true";

    let eligibleVendors = [];

    try {
      const pipeline = [
        {
          $geoNear: {
            near: { type: "Point", coordinates: [lng, lat] },
            distanceField: "distanceMeters",
            spherical: true,
            query: {
              status: { $in: ["approved", "active"] },
            },
          },
        },
        {
          $addFields: {
            isWithinRadius: {
              $lte: [
                "$distanceMeters",
                { $multiply: [{ $ifNull: ["$deliveryRadiusKm", 5] }, 1000] },
              ],
            },
            distanceKm: { $round: [{ $divide: ["$distanceMeters", 1000] }, 1] },
          },
        },
      ];

      if (!showAll) {
        pipeline.push({
          $match: {
            isStoreOpen: { $ne: false },
            isWithinRadius: true,
          },
        });
      }

      pipeline.push({
        $project: {
          _id: 1,
          storeName: {
            $ifNull: [
              "$businessDetails.businessName",
              { $ifNull: ["$brandDetails.brandName", "Local Partner Store"] },
            ],
          },
          businessDetails: 1,
          sellerDetails: 1,
          brandDetails: 1,
          shippingLocations: 1,
          deliveryRadiusKm: 1,
          isStoreOpen: 1,
          distanceMeters: 1,
          distanceKm: 1,
          isWithinRadius: 1,
        },
      });

      eligibleVendors = await Vendor.aggregate(pipeline);
    } catch (geoErr) {
      console.warn("[getNearbyVendors GeoNear fallback]:", geoErr.message);
      const query = { status: { $in: ["approved", "active"] } };
      if (!showAll) query.isStoreOpen = { $ne: false };

      const vendors = await Vendor.find(query).lean();

      eligibleVendors = vendors
        .map((v) => {
          const vLng =
            v.shippingLocations?.longitude || v.location?.coordinates?.[0] || 85.324;
          const vLat =
            v.shippingLocations?.latitude || v.location?.coordinates?.[1] || 27.7172;
          const dist = calculateDistanceKm(lat, lng, vLat, vLng);
          const radius = v.deliveryRadiusKm || 5;
          const isEligible = dist <= radius;
          return {
            ...v,
            storeName:
              v.businessDetails?.businessName ||
              v.brandDetails?.brandName ||
              "Local Partner Store",
            distanceKm: Math.round(dist * 10) / 10,
            distanceMeters: Math.round(dist * 1000),
            isWithinRadius: isEligible,
            isEligible,
          };
        })
        .filter((v) => (showAll ? true : v.isWithinRadius && v.isStoreOpen !== false))
        .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0));
    }

    return res.status(200).json({
      success: true,
      count: eligibleVendors.length,
      coordinates: { latitude: lat, longitude: lng },
      data: eligibleVendors,
    });
  } catch (error) {
    console.error("[Get Nearby Vendors Error]:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch nearby vendors.",
    });
  }
};

import Vendor from "../models/Vendor.js";
import User from "../models/User.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

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

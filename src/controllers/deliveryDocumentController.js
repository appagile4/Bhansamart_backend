import DeliveryBoy from "../models/DeliveryBoy.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";

const VALID_DOC_TYPES = ["panCard", "aadhaarCard", "drivingLicense", "vehicleRc"];

/**
 * Submit / Update document for verification with Cloudinary upload
 * POST /api/delivery/documents/upload
 */
export const uploadOrUpdateDocument = async (req, res, next) => {
  try {
    const { documentType, documentNumber, expiryDate } = req.body;
    let frontUrl = req.body.frontUrl || "";
    let backUrl = req.body.backUrl || "";

    if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
      return next(
        new AppError(
          `Invalid documentType. Must be one of: ${VALID_DOC_TYPES.join(", ")}`,
          400
        )
      );
    }

    // 1. Handle file upload via Multer (multipart/form-data)
    if (req.files) {
      if (req.files.frontImage?.[0]) {
        const uploadRes = await uploadToCloudinary(
          req.files.frontImage[0].buffer,
          "bhansamart/delivery/documents"
        );
        frontUrl = uploadRes.secure_url;
      }
      if (req.files.backImage?.[0]) {
        const uploadRes = await uploadToCloudinary(
          req.files.backImage[0].buffer,
          "bhansamart/delivery/documents"
        );
        backUrl = uploadRes.secure_url;
      }
      if (!frontUrl && req.files.image?.[0]) {
        const uploadRes = await uploadToCloudinary(
          req.files.image[0].buffer,
          "bhansamart/delivery/documents"
        );
        frontUrl = uploadRes.secure_url;
      }
      if (!frontUrl && req.files.file?.[0]) {
        const uploadRes = await uploadToCloudinary(
          req.files.file[0].buffer,
          "bhansamart/delivery/documents"
        );
        frontUrl = uploadRes.secure_url;
      }
    } else if (req.file) {
      const uploadRes = await uploadToCloudinary(
        req.file.buffer,
        "bhansamart/delivery/documents"
      );
      frontUrl = uploadRes.secure_url;
    }

    // 2. Also handle base64 image strings if provided in JSON
    if (!frontUrl && req.body.frontImageBase64) {
      const uploadRes = await uploadToCloudinary(
        req.body.frontImageBase64,
        "bhansamart/delivery/documents"
      );
      frontUrl = uploadRes.secure_url;
    }
    if (!backUrl && req.body.backImageBase64) {
      const uploadRes = await uploadToCloudinary(
        req.body.backImageBase64,
        "bhansamart/delivery/documents"
      );
      backUrl = uploadRes.secure_url;
    }

    if (!frontUrl && !documentNumber) {
      return next(
        new AppError("Document photo (file) or document number is required", 400)
      );
    }

    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const currentDoc = deliveryBoy.documents[documentType] || {};

    // 3. Save to MongoDB
    deliveryBoy.documents[documentType] = {
      documentNumber: documentNumber ? String(documentNumber).trim() : currentDoc.documentNumber,
      frontUrl: frontUrl || currentDoc.frontUrl,
      backUrl: backUrl || currentDoc.backUrl,
      status: "PENDING_VERIFICATION", // Reset to pending verification on new upload
      rejectionReason: "", // Clear old rejection reason
      reviewerComments: "",
      verifiedAt: null,
      expiryDate: expiryDate ? new Date(expiryDate) : currentDoc.expiryDate,
    };

    // If delivery partner was approved but resubmits a required document, availability may be affected
    if (deliveryBoy.availability === "ONLINE" && !deliveryBoy.canGoOnline()) {
      deliveryBoy.availability = "OFFLINE";
    }

    await deliveryBoy.save();

    res.status(200).json({
      success: true,
      message: `${documentType} uploaded to Cloudinary and submitted for verification successfully.`,
      documentType,
      documentStatus: deliveryBoy.documents[documentType].status,
      frontUrl: deliveryBoy.documents[documentType].frontUrl,
      allVerified: deliveryBoy.areAllDocumentsVerified(),
      documents: deliveryBoy.getMaskedProfile().documents,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get document verification status
 * GET /api/delivery/documents/status
 */
export const getDocumentStatus = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const maskedProfile = deliveryBoy.getMaskedProfile();

    const summary = {
      panCard: deliveryBoy.documents?.panCard?.status || "NOT_SUBMITTED",
      aadhaarCard: deliveryBoy.documents?.aadhaarCard?.status || "NOT_SUBMITTED",
      drivingLicense: deliveryBoy.documents?.drivingLicense?.status || "NOT_SUBMITTED",
      vehicleRc: deliveryBoy.documents?.vehicleRc?.status || "NOT_SUBMITTED",
    };

    res.status(200).json({
      success: true,
      summary,
      allVerified: deliveryBoy.areAllDocumentsVerified(),
      documents: maskedProfile.documents,
    });
  } catch (error) {
    next(error);
  }
};

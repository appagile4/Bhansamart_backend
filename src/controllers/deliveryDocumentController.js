import DeliveryBoy from "../models/DeliveryBoy.js";
import { AppError } from "../middleware/errorMiddleware.js";

const VALID_DOC_TYPES = ["panCard", "aadhaarCard", "drivingLicense", "vehicleRc"];

/**
 * Submit / Update document for verification
 * POST /api/delivery/documents/upload
 */
export const uploadOrUpdateDocument = async (req, res, next) => {
  try {
    const { documentType, documentNumber, frontUrl, backUrl, expiryDate } = req.body;

    if (!documentType || !VALID_DOC_TYPES.includes(documentType)) {
      return next(
        new AppError(
          `Invalid documentType. Must be one of: ${VALID_DOC_TYPES.join(", ")}`,
          400
        )
      );
    }

    if (!frontUrl && !documentNumber) {
      return next(new AppError("Front image URL or document number is required", 400));
    }

    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const currentDoc = deliveryBoy.documents[documentType] || {};

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
      message: `${documentType} submitted for verification successfully.`,
      documentType,
      documentStatus: deliveryBoy.documents[documentType].status,
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

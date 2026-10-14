import DeliveryBoy from "../models/DeliveryBoy.js";
import User from "../models/User.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * List all delivery partners with filters
 * GET /api/admin/delivery/partners
 */
export const getAllDeliveryPartners = async (req, res, next) => {
  try {
    const {
      approvalStatus,
      depositStatus,
      availability,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};

    if (approvalStatus) filter.approvalStatus = approvalStatus;
    if (depositStatus) filter["securityDeposit.status"] = depositStatus;
    if (availability) filter.availability = availability;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await DeliveryBoy.countDocuments(filter);
    const partners = await DeliveryBoy.find(filter)
      .populate("user", "name email phone isActive status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      partners: partners.map((p) => p.getMaskedProfile()),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get delivery partner details by ID
 * GET /api/admin/delivery/partners/:id
 */
export const getDeliveryPartnerById = async (req, res, next) => {
  try {
    const partner = await DeliveryBoy.findById(req.params.id).populate(
      "user",
      "name email phone isActive status"
    );

    if (!partner) {
      return next(new AppError("Delivery partner not found", 404));
    }

    const depositLedger = await SecurityDepositLedger.find({ deliveryBoy: partner._id }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      partner: partner.getMaskedProfile(),
      canGoOnline: partner.canGoOnline(),
      allDocumentsVerified: partner.areAllDocumentsVerified(),
      depositHistory: depositLedger,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Review individual partner document (Approve / Reject / Resubmission)
 * PATCH /api/admin/delivery/partners/:id/document
 */
export const reviewPartnerDocument = async (req, res, next) => {
  try {
    const { documentType, status, rejectionReason, reviewerComments } = req.body;

    const validDocs = ["panCard", "aadhaarCard", "drivingLicense", "vehicleRc"];
    if (!documentType || !validDocs.includes(documentType)) {
      return next(
        new AppError(
          `Invalid documentType. Must be one of: ${validDocs.join(", ")}`,
          400
        )
      );
    }

    const validStatuses = [
      "VERIFIED",
      "REJECTED",
      "RESUBMISSION_REQUIRED",
      "UNDER_REVIEW",
    ];
    if (!status || !validStatuses.includes(status)) {
      return next(
        new AppError(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          400
        )
      );
    }

    const partner = await DeliveryBoy.findById(req.params.id);
    if (!partner) {
      return next(new AppError("Delivery partner not found", 404));
    }

    const doc = partner.documents[documentType] || {};
    doc.status = status;
    doc.reviewerComments = reviewerComments || "";

    if (status === "VERIFIED") {
      doc.verifiedAt = new Date();
      doc.rejectionReason = "";
    } else {
      doc.verifiedAt = null;
      doc.rejectionReason = rejectionReason || "Document verification rejected";

      // If document is not verified, force partner OFFLINE if currently online
      if (partner.availability === "ONLINE") {
        partner.availability = "OFFLINE";
      }
    }

    partner.documents[documentType] = doc;
    await partner.save();

    res.status(200).json({
      success: true,
      message: `${documentType} status updated to ${status}`,
      documentType,
      document: doc,
      allDocumentsVerified: partner.areAllDocumentsVerified(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update partner overall approval status (Approve / Reject / Suspend)
 * PATCH /api/admin/delivery/partners/:id/approval
 */
export const updatePartnerApproval = async (req, res, next) => {
  try {
    const { approvalStatus, adminRemarks } = req.body;

    const validStatuses = [
      "APPROVED",
      "REJECTED",
      "SUSPENDED",
      "DEACTIVATED",
      "PENDING_APPROVAL",
    ];
    if (!approvalStatus || !validStatuses.includes(approvalStatus)) {
      return next(
        new AppError(
          `Invalid approvalStatus. Must be one of: ${validStatuses.join(", ")}`,
          400
        )
      );
    }

    const partner = await DeliveryBoy.findById(req.params.id);
    if (!partner) {
      return next(new AppError("Delivery partner not found", 404));
    }

    // STRICT CHECK: Cannot approve unless all 4 documents are VERIFIED & ₹1,000 deposit is PAID
    if (approvalStatus === "APPROVED") {
      const missingCriteria = [];

      if (!partner.areAllDocumentsVerified()) {
        const docs = partner.documents;
        if (docs.panCard?.status !== "VERIFIED") missingCriteria.push("PAN Card not verified");
        if (docs.aadhaarCard?.status !== "VERIFIED") missingCriteria.push("Aadhaar Card not verified");
        if (docs.drivingLicense?.status !== "VERIFIED") missingCriteria.push("Driving License not verified");
        if (docs.vehicleRc?.status !== "VERIFIED") missingCriteria.push("Vehicle RC not verified");
      }

      if (partner.securityDeposit?.status !== "PAID") {
        missingCriteria.push("₹1,000 security deposit not paid (Current status: " + (partner.securityDeposit?.status || "PENDING") + ")");
      }

      if (missingCriteria.length > 0) {
        return next(
          new AppError(
            `Cannot approve delivery partner. Unmet requirements: ${missingCriteria.join("; ")}`,
            400
          )
        );
      }

      partner.approvalStatus = "APPROVED";
      partner.approvedBy = req.user._id;
      partner.approvedAt = new Date();
      partner.adminRemarks = adminRemarks || "Approved by admin";

      // Also mark underlying user as active & approved
      await User.findByIdAndUpdate(partner.user, {
        $set: { isApproved: true, status: "approved" },
      });
    } else {
      partner.approvalStatus = approvalStatus;
      partner.adminRemarks = adminRemarks || "";

      // If suspended or deactivated, toggle to OFFLINE
      if (["SUSPENDED", "DEACTIVATED", "REJECTED"].includes(approvalStatus)) {
        partner.availability = "OFFLINE";
      }
    }

    await partner.save();

    res.status(200).json({
      success: true,
      message: `Delivery partner approval status updated to ${approvalStatus}`,
      approvalStatus: partner.approvalStatus,
      partner: partner.getMaskedProfile(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all security deposit ledger transactions
 * GET /api/admin/delivery/deposits
 */
export const getAllSecurityDeposits = async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await SecurityDepositLedger.countDocuments(filter);
    const deposits = await SecurityDepositLedger.find(filter)
      .populate("deliveryBoy", "fullName phone email")
      .populate("user", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      deposits,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process Security Deposit Refund
 * POST /api/admin/delivery/partners/:id/refund-deposit
 */
export const processDepositRefund = async (req, res, next) => {
  try {
    const partner = await DeliveryBoy.findById(req.params.id);
    if (!partner) {
      return next(new AppError("Delivery partner not found", 404));
    }

    if (partner.activeOrderId) {
      return next(
        new AppError("Cannot refund deposit: partner has an active delivery in progress", 400)
      );
    }

    if (partner.securityDeposit?.status === "REFUNDED") {
      return next(new AppError("Security deposit has already been refunded", 400));
    }

    const now = new Date();

    // Update pending refund ledger entry or create completed refund ledger
    let refundLedger = await SecurityDepositLedger.findOne({
      deliveryBoy: partner._id,
      type: "DEPOSIT_REFUND",
      status: "REFUND_REQUESTED",
    });

    if (refundLedger) {
      refundLedger.status = "REFUNDED";
      refundLedger.refundProcessedAt = now;
      refundLedger.refundApprovedBy = req.user._id;
      await refundLedger.save();
    } else {
      refundLedger = await SecurityDepositLedger.create({
        deliveryBoy: partner._id,
        user: partner.user,
        amount: 1000,
        currency: "INR",
        type: "DEPOSIT_REFUND",
        status: "REFUNDED",
        transactionId: `REF-${Date.now()}`,
        refundProcessedAt: now,
        refundApprovedBy: req.user._id,
      });
    }

    partner.securityDeposit.status = "REFUNDED";
    partner.approvalStatus = "DEACTIVATED";
    partner.availability = "OFFLINE";
    await partner.save();

    res.status(200).json({
      success: true,
      message: "Security deposit refunded successfully. Partner deactivated.",
      refundLedger,
    });
  } catch (error) {
    next(error);
  }
};

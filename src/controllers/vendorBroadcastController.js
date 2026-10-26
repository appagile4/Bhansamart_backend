import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import VendorNotification from "../models/VendorNotification.js";
import VendorBroadcast from "../models/VendorBroadcast.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { logAdminAction } from "../services/auditService.js";
import { emitVendorNotification } from "../socket/socketManager.js";

/**
 * Helper: Resolve and check StaffAdmin's broadcast permissions against DB
 */
export const getAdminBroadcastPermissions = async (user) => {
  if (user.role === "superadmin") {
    return {
      canBroadcastToAssignedVendors: true,
      canBroadcastToSpecificVendors: true,
      canBroadcastToAllVendors: true,
      isSuperAdmin: true,
      hasAnyBroadcastPermission: true,
    };
  }

  const freshUser = await User.findById(user._id).select("adminPermissions assignedVendors role");
  if (!freshUser) {
    return {
      canBroadcastToAssignedVendors: false,
      canBroadcastToSpecificVendors: false,
      canBroadcastToAllVendors: false,
      isSuperAdmin: false,
      hasAnyBroadcastPermission: false,
    };
  }

  const perms = freshUser.adminPermissions || {};
  const canBroadcastToAssignedVendors = Boolean(perms.canBroadcastToAssignedVendors);
  const canBroadcastToSpecificVendors = Boolean(perms.canBroadcastToSpecificVendors);
  const canBroadcastToAllVendors = Boolean(perms.canBroadcastToAllVendors);

  return {
    canBroadcastToAssignedVendors,
    canBroadcastToSpecificVendors,
    canBroadcastToAllVendors,
    isSuperAdmin: false,
    hasAnyBroadcastPermission:
      canBroadcastToAssignedVendors ||
      canBroadcastToSpecificVendors ||
      canBroadcastToAllVendors,
    assignedVendors: freshUser.assignedVendors || [],
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. GET CURRENT ADMIN'S BROADCAST PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════

export const getBroadcastPermissions = async (req, res, next) => {
  try {
    const permissions = await getAdminBroadcastPermissions(req.user);
    res.status(200).json({
      success: true,
      data: permissions,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. GET ELIGIBLE VENDORS FOR SELECTION (STRICTLY SCOPED)
// ═══════════════════════════════════════════════════════════════════════════

export const getBroadcastEligibleVendors = async (req, res, next) => {
  try {
    const perms = await getAdminBroadcastPermissions(req.user);

    if (!perms.hasAnyBroadcastPermission && !perms.isSuperAdmin) {
      return next(
        new AppError(
          "Access denied. You do not have permission to send vendor broadcast notifications.",
          403
        )
      );
    }

    const { search = "", page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const query = {
      status: { $in: ["approved", "active"] },
    };

    // If StaffAdmin without platform-wide permission, restrict to assigned vendors
    if (!perms.isSuperAdmin && !perms.canBroadcastToAllVendors) {
      const assignedIds = (perms.assignedVendors || [])
        .map((v) => (v._id || v).toString())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (assignedIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: { vendors: [], total: 0, page: pageNum, pages: 0 },
        });
      }

      query._id = { $in: assignedIds };
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { "businessDetails.businessName": { $regex: q, $options: "i" } },
        { "sellerDetails.sellerName": { $regex: q, $options: "i" } },
        { "sellerDetails.sellerEmail": { $regex: q, $options: "i" } },
        { "sellerDetails.sellerPhone": { $regex: q, $options: "i" } },
      ];
    }

    const [vendors, total] = await Promise.all([
      Vendor.find(query)
        .select(
          "_id businessDetails.businessName sellerDetails.sellerName sellerDetails.sellerEmail sellerDetails.sellerPhone status isStoreOpen"
        )
        .sort({ "businessDetails.businessName": 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Vendor.countDocuments(query),
    ]);

    const formatted = vendors.map((v) => ({
      _id: v._id,
      businessName:
        v.businessDetails?.businessName ||
        v.sellerDetails?.sellerName ||
        "Unnamed Vendor",
      sellerName: v.sellerDetails?.sellerName || "",
      sellerEmail: v.sellerDetails?.sellerEmail || "",
      sellerPhone: v.sellerDetails?.sellerPhone || "",
      status: v.status,
      isStoreOpen: v.isStoreOpen,
    }));

    res.status(200).json({
      success: true,
      data: {
        vendors: formatted,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. RECIPIENT COUNT PREVIEW (SERVER-SIDE REVALIDATION)
// ═══════════════════════════════════════════════════════════════════════════

export const getBroadcastRecipientPreview = async (req, res, next) => {
  try {
    const { targetType, vendorIds = [] } = req.query;
    const perms = await getAdminBroadcastPermissions(req.user);

    if (!perms.hasAnyBroadcastPermission && !perms.isSuperAdmin) {
      return next(
        new AppError(
          "Access denied. You do not have permission to send vendor broadcast notifications.",
          403
        )
      );
    }

    let recipientCount = 0;
    const query = { status: { $in: ["approved", "active"] } };

    if (targetType === "ASSIGNED_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToAssignedVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to broadcast to assigned vendors.",
            403
          )
        );
      }

      if (perms.isSuperAdmin) {
        // Superadmin without explicit vendor assignments targets all active vendors
        recipientCount = await Vendor.countDocuments(query);
      } else {
        const assignedIds = (perms.assignedVendors || [])
          .map((v) => (v._id || v).toString())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));

        recipientCount = await Vendor.countDocuments({
          ...query,
          _id: { $in: assignedIds },
        });
      }
    } else if (targetType === "SPECIFIC_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToSpecificVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to target specific vendors.",
            403
          )
        );
      }

      let parsedIds = [];
      if (Array.isArray(vendorIds)) {
        parsedIds = vendorIds;
      } else if (typeof vendorIds === "string") {
        parsedIds = vendorIds.split(",").map((s) => s.trim());
      }

      const validObjectIds = parsedIds
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validObjectIds.length === 0) {
        recipientCount = 0;
      } else {
        // Check scope if staff admin
        if (!perms.isSuperAdmin && !perms.canBroadcastToAllVendors) {
          const assignedStrIds = (perms.assignedVendors || []).map((v) =>
            (v._id || v).toString()
          );
          const unauthorized = validObjectIds.filter(
            (id) => !assignedStrIds.includes(id.toString())
          );
          if (unauthorized.length > 0) {
            return next(
              new AppError(
                "Access denied. Some selected vendors are not assigned to you.",
                403
              )
            );
          }
        }

        recipientCount = await Vendor.countDocuments({
          ...query,
          _id: { $in: validObjectIds },
        });
      }
    } else if (targetType === "ALL_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToAllVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to broadcast to all vendors on the platform.",
            403
          )
        );
      }

      recipientCount = await Vendor.countDocuments(query);
    } else {
      return next(
        new AppError(
          "Invalid targetType. Must be ASSIGNED_VENDORS, SPECIFIC_VENDORS, or ALL_VENDORS.",
          400
        )
      );
    }

    res.status(200).json({
      success: true,
      data: {
        targetType,
        recipientCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. SEND VENDOR BROADCAST NOTIFICATION (PERSISTENT & REAL-TIME)
// ═══════════════════════════════════════════════════════════════════════════

export const sendVendorBroadcast = async (req, res, next) => {
  try {
    const {
      title,
      message,
      targetType,
      vendorIds = [],
      notificationType = "ANNOUNCEMENT",
      imageUrl = "",
      scheduledAt = null,
      idempotencyKey,
    } = req.body;

    // 1. Validation
    if (!title || !title.trim()) {
      return next(new AppError("Notification title is required", 400));
    }
    if (!message || !message.trim()) {
      return next(new AppError("Notification message is required", 400));
    }
    if (title.trim().length > 150) {
      return next(new AppError("Notification title cannot exceed 150 characters", 400));
    }
    if (message.trim().length > 2000) {
      return next(new AppError("Notification message cannot exceed 2000 characters", 400));
    }
    if (!["ASSIGNED_VENDORS", "SPECIFIC_VENDORS", "ALL_VENDORS"].includes(targetType)) {
      return next(
        new AppError(
          "Invalid targetType. Must be ASSIGNED_VENDORS, SPECIFIC_VENDORS, or ALL_VENDORS.",
          400
        )
      );
    }

    // 2. Idempotency Check
    if (idempotencyKey) {
      const existing = await VendorBroadcast.findOne({ idempotencyKey });
      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Broadcast already submitted (idempotent response)",
          data: existing,
        });
      }
    }

    // 3. Permission Enforcement
    const perms = await getAdminBroadcastPermissions(req.user);

    if (!perms.hasAnyBroadcastPermission && !perms.isSuperAdmin) {
      return next(
        new AppError(
          "Access denied. You do not have permission to send vendor broadcast notifications.",
          403
        )
      );
    }

    const query = { status: { $in: ["approved", "active"] } };
    let targetVendors = [];

    // 4. Resolve Target Recipients based on Target Type & Permitted Scope
    if (targetType === "ASSIGNED_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToAssignedVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to send notifications to assigned vendors.",
            403
          )
        );
      }

      if (perms.isSuperAdmin) {
        targetVendors = await Vendor.find(query).select("_id businessDetails.businessName").lean();
      } else {
        const assignedIds = (perms.assignedVendors || [])
          .map((v) => (v._id || v).toString())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .map((id) => new mongoose.Types.ObjectId(id));

        if (assignedIds.length === 0) {
          return next(
            new AppError("You currently have no stores assigned to manage.", 400)
          );
        }

        targetVendors = await Vendor.find({
          ...query,
          _id: { $in: assignedIds },
        })
          .select("_id businessDetails.businessName")
          .lean();
      }
    } else if (targetType === "SPECIFIC_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToSpecificVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to send notifications to specific vendors.",
            403
          )
        );
      }

      if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
        return next(
          new AppError(
            "Please select at least one vendor to receive this notification.",
            400
          )
        );
      }

      const validObjectIds = vendorIds
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (validObjectIds.length === 0) {
        return next(new AppError("No valid vendor IDs provided", 400));
      }

      // If Staff Admin lacks platform-wide scope, strictly verify every ID against assigned stores
      if (!perms.isSuperAdmin && !perms.canBroadcastToAllVendors) {
        const assignedStrIds = (perms.assignedVendors || []).map((v) =>
          (v._id || v).toString()
        );
        const unauthorized = validObjectIds.filter(
          (id) => !assignedStrIds.includes(id.toString())
        );

        if (unauthorized.length > 0) {
          return next(
            new AppError(
              `Access denied. ${unauthorized.length} selected vendor(s) are outside your assigned store scope.`,
              403
            )
          );
        }
      }

      targetVendors = await Vendor.find({
        ...query,
        _id: { $in: validObjectIds },
      })
        .select("_id businessDetails.businessName")
        .lean();
    } else if (targetType === "ALL_VENDORS") {
      if (!perms.isSuperAdmin && !perms.canBroadcastToAllVendors) {
        return next(
          new AppError(
            "Access denied. You do not have permission to broadcast to all vendors on the platform.",
            403
          )
        );
      }

      targetVendors = await Vendor.find(query)
        .select("_id businessDetails.businessName")
        .lean();
    }

    if (targetVendors.length === 0) {
      return next(
        new AppError(
          "No active eligible vendor recipients found for the selected audience.",
          400
        )
      );
    }

    const recipientVendorIds = targetVendors.map((v) => v._id);

    // 5. Create Broadcast Audit Entry
    const broadcast = await VendorBroadcast.create({
      sender: req.user._id,
      senderName: req.user.name || "Admin",
      senderEmail: req.user.email || "",
      senderRole: req.user.role || "admin",
      title: title.trim(),
      message: message.trim(),
      notificationType,
      targetType,
      targetVendorIds: recipientVendorIds,
      recipientCount: recipientVendorIds.length,
      deliveredVendorIds: recipientVendorIds,
      failedVendorIds: [],
      status: "SENT",
      imageUrl: imageUrl ? imageUrl.trim() : "",
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      sentAt: new Date(),
      idempotencyKey: idempotencyKey || null,
    });

    // 6. Persist Notifications in Batches (Database Persistence)
    const BATCH_SIZE = 100;
    const notificationDocs = recipientVendorIds.map((vId) => ({
      vendor: vId,
      type: notificationType,
      title: title.trim(),
      message: message.trim(),
      data: {
        broadcastId: broadcast._id,
        senderName: req.user.name || "Admin",
        senderRole: req.user.role,
        targetType,
        imageUrl: imageUrl || undefined,
      },
      isRead: false,
    }));

    for (let i = 0; i < notificationDocs.length; i += BATCH_SIZE) {
      const batch = notificationDocs.slice(i, i + BATCH_SIZE);
      await VendorNotification.insertMany(batch, { ordered: false });
    }

    // 7. Emit Real-time Socket.IO Events to Each Vendor Room
    const socketPayload = {
      _id: broadcast._id,
      title: title.trim(),
      message: message.trim(),
      type: notificationType,
      imageUrl: imageUrl || undefined,
      senderName: req.user.name || "Admin",
      createdAt: new Date(),
      isRead: false,
    };

    recipientVendorIds.forEach((vId) => {
      emitVendorNotification(vId.toString(), socketPayload);
    });

    // 8. Security & Compliance Audit Log Entry
    await logAdminAction({
      req,
      action: "BROADCAST_VENDOR_NOTIFICATION",
      targetResource: "VendorBroadcast",
      targetId: broadcast._id.toString(),
      details: `${req.user.role === "superadmin" ? "Superadmin" : "Staff Admin"} ${req.user.name} broadcast "${title.trim()}" to ${targetType} (${recipientVendorIds.length} stores)`,
      changes: {
        broadcastId: broadcast._id,
        targetType,
        notificationType,
        recipientCount: recipientVendorIds.length,
      },
    });

    res.status(201).json({
      success: true,
      message: `Broadcast notification successfully sent to ${recipientVendorIds.length} vendor(s)`,
      data: {
        broadcastId: broadcast._id,
        recipientCount: recipientVendorIds.length,
        targetType,
        sentAt: broadcast.sentAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. GET BROADCAST HISTORY (SUPER ADMIN PLATFORM-WIDE | STAFF ADMIN OWN)
// ═══════════════════════════════════════════════════════════════════════════

export const getBroadcastHistory = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const { page = 1, limit = 20, targetType = "ALL", search = "" } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const query = {};

    // Staff Admin can ONLY view broadcasts they sent
    if (!isSuperAdmin) {
      query.sender = req.user._id;
    }

    if (targetType && targetType !== "ALL") {
      query.targetType = targetType;
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { title: { $regex: q, $options: "i" } },
        { message: { $regex: q, $options: "i" } },
        { senderName: { $regex: q, $options: "i" } },
      ];
    }

    const [broadcasts, total] = await Promise.all([
      VendorBroadcast.find(query)
        .populate("sender", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VendorBroadcast.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        broadcasts,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

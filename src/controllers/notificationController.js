import DeviceToken from "../models/DeviceToken.js";
import Notification from "../models/Notification.js";
import VendorNotification from "../models/VendorNotification.js";
import Vendor from "../models/Vendor.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Register or refresh a push device token for the authenticated user
 * POST /api/notifications/devices/register
 */
export const registerDeviceToken = async (req, res, next) => {
  try {
    const {
      token,
      tokenType = "expo",
      platform = "unknown",
      deviceId = "",
      deviceName = "",
      appVersion = "1.0.0",
      role,
      webSubscription = null,
    } = req.body;

    if (!token || typeof token !== "string" || !token.trim()) {
      return next(new AppError("Valid device push token is required", 400));
    }

    const cleanToken = token.trim();
    const effectiveRole = role || req.user.role || "customer";

    // Lookup vendor profile if role is vendor
    let vendorId = null;
    if (effectiveRole === "vendor" || req.user.role === "vendor") {
      const vendorDoc = await Vendor.findOne({ userId: req.user._id }).select("_id");
      if (vendorDoc) vendorId = vendorDoc._id;
    }

    // Lookup delivery boy profile if role is delivery_boy
    let deliveryBoyId = null;
    if (effectiveRole === "delivery_boy" || req.user.role === "delivery_boy") {
      const deliveryDoc = await DeliveryBoy.findOne({ user: req.user._id }).select("_id");
      if (deliveryDoc) deliveryBoyId = deliveryDoc._id;
    }

    // Upsert the device token: if this token was previously registered to another user/session, transfer it to current user
    const deviceRecord = await DeviceToken.findOneAndUpdate(
      { token: cleanToken },
      {
        $set: {
          user: req.user._id,
          vendor: vendorId,
          deliveryBoy: deliveryBoyId,
          role: effectiveRole,
          tokenType,
          platform: ["android", "ios", "web"].includes(platform.toLowerCase()) ? platform.toLowerCase() : "unknown",
          deviceId: deviceId || "",
          deviceName: deviceName || "",
          appVersion: appVersion || "1.0.0",
          webSubscription: webSubscription || null,
          isActive: true,
          lastUsedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Device push token registered successfully",
      data: {
        id: deviceRecord._id,
        token: deviceRecord.token,
        role: deviceRecord.role,
        platform: deviceRecord.platform,
        isActive: deviceRecord.isActive,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unregister / deactivate a device token upon logout
 * POST /api/notifications/devices/unregister
 */
export const unregisterDeviceToken = async (req, res, next) => {
  try {
    const { token, deviceId } = req.body;

    if (!token && !deviceId) {
      return next(new AppError("Token or deviceId is required to unregister device", 400));
    }

    const query = { user: req.user._id };
    if (token) query.token = token.trim();
    if (deviceId) query.deviceId = deviceId.trim();

    await DeviceToken.updateMany(query, {
      $set: { isActive: false, deactivationReason: "UserLogout" },
    });

    res.status(200).json({
      success: true,
      message: "Device token unregistered successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get paginated notifications for current authenticated user
 * GET /api/notifications/my
 */
export const getMyNotifications = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const isVendorRole = req.user.role === "vendor" || req.query.role === "vendor";

    if (isVendorRole) {
      const vendorDoc = await Vendor.findOne({ userId: req.user._id }).select("_id");
      const vId = vendorDoc?._id || req.user.assignedVendors?.[0] || req.user._id;

      const [notifications, total, unreadCount] = await Promise.all([
        VendorNotification.find({ vendor: vId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        VendorNotification.countDocuments({ vendor: vId }),
        VendorNotification.countDocuments({ vendor: vId, isRead: false }),
      ]);

      return res.status(200).json({
        success: true,
        count: notifications.length,
        total,
        unreadCount,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        data: notifications,
      });
    }

    // Default Customer / Delivery Boy / Admin
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ user: req.user._id }),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      unreadCount,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: notifications,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a single notification as read
 * PATCH /api/notifications/:id/read
 */
export const markNotificationAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check in Notification first
    let notif = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    );

    // If not found, check in VendorNotification
    if (!notif) {
      const vendorDoc = await Vendor.findOne({ userId: req.user._id }).select("_id");
      if (vendorDoc) {
        notif = await VendorNotification.findOneAndUpdate(
          { _id: id, vendor: vendorDoc._id },
          { $set: { isRead: true, readAt: new Date() } },
          { new: true }
        );
      }
    }

    if (!notif) {
      return next(new AppError("Notification not found or access denied", 404));
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notif,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications as read for current user
 * PATCH /api/notifications/read-all
 */
export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const isVendorRole = req.user.role === "vendor" || req.query.role === "vendor";

    if (isVendorRole) {
      const vendorDoc = await Vendor.findOne({ userId: req.user._id }).select("_id");
      if (vendorDoc) {
        await VendorNotification.updateMany(
          { vendor: vendorDoc._id, isRead: false },
          { $set: { isRead: true, readAt: new Date() } }
        );
      }
    } else {
      await Notification.updateMany(
        { user: req.user._id, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
      );
    }

    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unread notification badge count
 * GET /api/notifications/unread-count
 */
export const getUnreadNotificationCount = async (req, res, next) => {
  try {
    const isVendorRole = req.user.role === "vendor" || req.query.role === "vendor";

    let unreadCount = 0;
    if (isVendorRole) {
      const vendorDoc = await Vendor.findOne({ userId: req.user._id }).select("_id");
      if (vendorDoc) {
        unreadCount = await VendorNotification.countDocuments({
          vendor: vendorDoc._id,
          isRead: false,
        });
      }
    } else {
      unreadCount = await Notification.countDocuments({
        user: req.user._id,
        isRead: false,
      });
    }

    res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
};

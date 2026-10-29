import Notification from "../models/Notification.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import { emitToDeliveryPartner } from "../socket/socketManager.js";
import { sendPushToDeliveryPartners } from "./pushNotificationService.js";

export const NOTIFICATION_CATEGORIES = {
  DELIVERY: "delivery",
  PAYMENTS: "payments",
  ACCOUNT: "account",
  ANNOUNCEMENTS: "announcements",
  SYSTEM: "system",
};

export const NOTIFICATION_CATEGORY_MAP = {
  delivery_request_received: "delivery",
  delivery_request_expired: "delivery",
  delivery_assignment_confirmed: "delivery",
  delivery_pickup_reminder: "delivery",
  delivery_handover_otp_available: "delivery",
  delivery_out_for_delivery: "delivery",
  delivery_completed: "delivery",
  delivery_cancelled: "delivery",
  delivery_earnings_updated: "payments",
  delivery_payout_updated: "payments",
  delivery_account_verification_updated: "account",
  delivery_portal_announcement: "announcements",
  system: "system",
};

/**
 * Create a persistent delivery boy notification, send real-time Socket.IO event,
 * and dispatch high-priority push notification.
 */
export const createDeliveryNotification = async ({
  deliveryBoyId,
  userId = null,
  type,
  title,
  message,
  data = {},
  category = null,
  channelId = "delivery",
}) => {
  try {
    let targetUserId = userId;
    let dBoyId = deliveryBoyId;

    if (!targetUserId && deliveryBoyId) {
      const dBoy = await DeliveryBoy.findById(deliveryBoyId).select("user");
      targetUserId = dBoy?.user;
    } else if (!dBoyId && userId) {
      const dBoy = await DeliveryBoy.findOne({ user: userId }).select("_id");
      dBoyId = dBoy?._id;
    }

    if (!targetUserId) {
      console.warn(`[createDeliveryNotification] Target user ID missing for deliveryBoyId: ${deliveryBoyId}`);
      return null;
    }

    const resolvedCategory = category || NOTIFICATION_CATEGORY_MAP[type] || "system";

    const notification = await Notification.create({
      user: targetUserId,
      deliveryBoy: dBoyId || null,
      targetRole: "delivery_boy",
      category: resolvedCategory,
      type,
      title,
      message,
      data,
      isRead: false,
    });

    // 1. Real-time private socket emission to delivery partner
    if (dBoyId) {
      emitToDeliveryPartner(
        dBoyId.toString(),
        "delivery:notification",
        notification,
        targetUserId.toString()
      );
    }

    // 2. High-priority push notification
    if (dBoyId) {
      sendPushToDeliveryPartners({
        deliveryBoyIds: [dBoyId],
        title,
        body: message,
        data: {
          ...data,
          notificationId: notification._id.toString(),
          type,
          category: resolvedCategory,
          screen: data.screen || "DeliveryMain/notifications",
        },
        channelId,
        priority: "high",
      }).catch((err) => console.warn("[Push Error for Rider]:", err.message));
    }

    return notification;
  } catch (error) {
    console.error("[createDeliveryNotification Error]:", error);
    return null;
  }
};

export const notifyDeliveryRequestReceived = async (deliveryBoyId, order, countdownSeconds = 45) => {
  return createDeliveryNotification({
    deliveryBoyId,
    type: "delivery_request_received",
    title: `New Delivery Request: #${order.orderNumber || order._id}`,
    message: `You have ${countdownSeconds} seconds to accept order #${order.orderNumber || order._id}.`,
    data: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      countdownSeconds,
    },
    category: "delivery",
  });
};

export const notifyDeliveryAssignmentConfirmed = async (deliveryBoyId, order) => {
  return createDeliveryNotification({
    deliveryBoyId,
    type: "delivery_assignment_confirmed",
    title: `Delivery Assigned: #${order.orderNumber || order._id}`,
    message: `You are assigned to order #${order.orderNumber || order._id}. Head to the store for pickup!`,
    data: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
    },
    category: "delivery",
  });
};

export const notifyDeliveryRequestExpired = async (deliveryBoyId, order) => {
  return createDeliveryNotification({
    deliveryBoyId,
    type: "delivery_request_expired",
    title: `Request Expired: #${order.orderNumber || order._id}`,
    message: `Offer window expired for order #${order.orderNumber || order._id} and was passed to another partner.`,
    data: {
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
    },
    category: "delivery",
  });
};

export const notifyDeliveryPortalAnnouncement = async (message, title = "Delivery Partner Announcement") => {
  return Notification.create({
    user: null,
    deliveryBoy: null,
    targetRole: "delivery_boy",
    category: "announcements",
    type: "delivery_portal_announcement",
    title,
    message,
    data: {},
    isRead: false,
  });
};

export default {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_MAP,
  createDeliveryNotification,
  notifyDeliveryRequestReceived,
  notifyDeliveryAssignmentConfirmed,
  notifyDeliveryRequestExpired,
  notifyDeliveryPortalAnnouncement,
};

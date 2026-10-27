import { Expo } from "expo-server-sdk";
import DeviceToken from "../models/DeviceToken.js";
import Notification from "../models/Notification.js";
import VendorNotification from "../models/VendorNotification.js";
import { getIO, emitVendorNotification, emitToDeliveryPartner } from "../socket/socketManager.js";

// Initialize Expo SDK client
const expoClient = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  useFcmV1: true,
});

/**
 * Format and sanitize push notification payload
 */
const buildMessagePayload = ({
  token,
  title,
  body,
  data = {},
  channelId = "default",
  sound = "default",
  priority = "high",
  badge = 1,
  ttl = 86400, // 24 hours
}) => {
  return {
    to: token,
    sound: sound || "default",
    title: title || "BhansaMart",
    body: body || "",
    data: {
      ...data,
      notificationId: data?.notificationId || `push_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
    },
    channelId: channelId || "default",
    priority: priority || "high",
    badge: typeof badge === "number" ? badge : 1,
    ttl,
    _displayInForeground: true,
  };
};

/**
 * Send raw push messages via Expo Push Service in chunks
 */
export const dispatchExpoPushChunks = async (messages) => {
  if (!messages || !messages.length) return { tickets: [], sentCount: 0, failedCount: 0 };

  const validMessages = messages.filter((m) => {
    if (!Expo.isExpoPushToken(m.to)) {
      console.warn(`[PushService] Skipped invalid Expo push token: ${m.to}`);
      return false;
    }
    return true;
  });

  if (!validMessages.length) {
    return { tickets: [], sentCount: 0, failedCount: 0 };
  }

  const chunks = expoClient.chunkPushNotifications(validMessages);
  const tickets = [];
  const invalidTokens = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expoClient.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);

      ticketChunk.forEach((ticket, idx) => {
        if (ticket.status === "error") {
          const targetToken = chunk[idx]?.to;
          console.warn(`[PushService] Push ticket error for token ${targetToken}:`, ticket.message, ticket.details?.error);

          if (ticket.details?.error === "DeviceNotRegistered") {
            invalidTokens.push(targetToken);
          }
        }
      });
    } catch (err) {
      console.error("[PushService] Failed sending push notification chunk:", err.message);
    }
  }

  // Auto-deactivate invalid / unregistered tokens from DB
  if (invalidTokens.length > 0) {
    DeviceToken.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { isActive: false, deactivationReason: "DeviceNotRegistered" } }
    ).catch((e) => console.warn("[PushService] Failed to deactivate invalid tokens:", e.message));
  }

  const successfulCount = tickets.filter((t) => t.status === "ok").length;
  const failureCount = tickets.filter((t) => t.status === "error").length;

  return {
    tickets,
    sentCount: successfulCount,
    failedCount: failureCount,
  };
};

/**
 * Send Push Notifications to targeted User IDs
 */
export const sendPushToUsers = async ({
  userIds,
  title,
  body,
  data = {},
  channelId = "orders",
  sound = "default",
  priority = "high",
}) => {
  try {
    if (!userIds || (Array.isArray(userIds) && !userIds.length)) return { sentCount: 0 };
    const ids = Array.isArray(userIds) ? userIds : [userIds];

    const tokens = await DeviceToken.find({
      user: { $in: ids },
      isActive: true,
      tokenType: "expo",
    }).select("token user").lean();

    if (!tokens.length) return { sentCount: 0 };

    const messages = tokens.map((t) =>
      buildMessagePayload({
        token: t.token,
        title,
        body,
        data: { ...data, userId: t.user?.toString() },
        channelId,
        sound,
        priority,
      })
    );

    return await dispatchExpoPushChunks(messages);
  } catch (err) {
    console.error("[PushService] sendPushToUsers error:", err.message);
    return { sentCount: 0, error: err.message };
  }
};

/**
 * Send Push Notifications to targeted Vendor Store IDs
 */
export const sendPushToVendors = async ({
  vendorIds,
  title,
  body,
  data = {},
  channelId = "orders",
  sound = "default",
  priority = "high",
}) => {
  try {
    if (!vendorIds || (Array.isArray(vendorIds) && !vendorIds.length)) return { sentCount: 0 };
    const vIds = Array.isArray(vendorIds) ? vendorIds : [vendorIds];

    const tokens = await DeviceToken.find({
      $or: [{ vendor: { $in: vIds } }, { user: { $in: vIds } }],
      role: "vendor",
      isActive: true,
      tokenType: "expo",
    }).select("token vendor user").lean();

    if (!tokens.length) return { sentCount: 0 };

    const messages = tokens.map((t) =>
      buildMessagePayload({
        token: t.token,
        title,
        body,
        data: { ...data, vendorId: t.vendor?.toString() || vIds[0] },
        channelId,
        sound,
        priority,
      })
    );

    return await dispatchExpoPushChunks(messages);
  } catch (err) {
    console.error("[PushService] sendPushToVendors error:", err.message);
    return { sentCount: 0, error: err.message };
  }
};

/**
 * Send Push Notifications to targeted Delivery Partners
 */
export const sendPushToDeliveryPartners = async ({
  deliveryBoyIds,
  title,
  body,
  data = {},
  channelId = "delivery",
  sound = "default",
  priority = "high",
}) => {
  try {
    if (!deliveryBoyIds || (Array.isArray(deliveryBoyIds) && !deliveryBoyIds.length)) return { sentCount: 0 };
    const dIds = Array.isArray(deliveryBoyIds) ? deliveryBoyIds : [deliveryBoyIds];

    const tokens = await DeviceToken.find({
      $or: [{ deliveryBoy: { $in: dIds } }, { user: { $in: dIds } }],
      role: "delivery_boy",
      isActive: true,
      tokenType: "expo",
    }).select("token deliveryBoy user").lean();

    if (!tokens.length) return { sentCount: 0 };

    const messages = tokens.map((t) =>
      buildMessagePayload({
        token: t.token,
        title,
        body,
        data: { ...data, deliveryBoyId: t.deliveryBoy?.toString() },
        channelId,
        sound,
        priority,
      })
    );

    return await dispatchExpoPushChunks(messages);
  } catch (err) {
    console.error("[PushService] sendPushToDeliveryPartners error:", err.message);
    return { sentCount: 0, error: err.message };
  }
};

/**
 * Send Push Notifications to entire roles (e.g. all vendors, all delivery boys, all customers, or admins)
 */
export const sendPushToRoles = async ({
  roles,
  title,
  body,
  data = {},
  channelId = "broadcasts",
  sound = "default",
  priority = "high",
}) => {
  try {
    const roleArr = Array.isArray(roles) ? roles : [roles];

    const tokens = await DeviceToken.find({
      role: { $in: roleArr },
      isActive: true,
      tokenType: "expo",
    }).select("token user role").lean();

    if (!tokens.length) return { sentCount: 0 };

    const messages = tokens.map((t) =>
      buildMessagePayload({
        token: t.token,
        title,
        body,
        data: { ...data, targetRole: t.role },
        channelId,
        sound,
        priority,
      })
    );

    return await dispatchExpoPushChunks(messages);
  } catch (err) {
    console.error("[PushService] sendPushToRoles error:", err.message);
    return { sentCount: 0, error: err.message };
  }
};

/**
 * High-Level Universal Dispatcher:
 * 1. Persists notifications in Database (Notification or VendorNotification)
 * 2. Emits real-time Socket.IO events (for foreground/active app)
 * 3. Delivers OS Push Notifications via Expo Push Service (for background/closed app)
 */
export const dispatchMarketplaceNotification = async ({
  // Recipients
  recipientUsers = [],
  recipientVendors = [],
  recipientDelivery = [],
  recipientRoles = [],

  // Content
  title,
  message,
  type = "system",
  data = {},
  channelId = "orders",

  // Customization
  sound = "default",
  priority = "high",
}) => {
  try {
    const io = getIO();
    const notifPayload = {
      title,
      message,
      type,
      data,
      createdAt: new Date().toISOString(),
    };

    // 1. Database Persistence & Socket Emission for Regular Users / Delivery / Staff
    const userIds = [...(Array.isArray(recipientUsers) ? recipientUsers : [recipientUsers])];

    if (recipientDelivery && recipientDelivery.length) {
      const dArr = Array.isArray(recipientDelivery) ? recipientDelivery : [recipientDelivery];
      userIds.push(...dArr);
    }

    if (userIds.length > 0) {
      const dbDocs = userIds.map((uId) => ({
        user: uId,
        title,
        message,
        type,
        data,
        isRead: false,
      }));

      Notification.insertMany(dbDocs, { ordered: false }).catch(() => {});

      // Sockets for individual users
      if (io) {
        userIds.forEach((uId) => {
          io.to(`user:${uId}`).emit("notification:direct", notifPayload);
        });
      }
    }

    // 2. Database Persistence & Socket Emission for Vendors
    const vIds = [...(Array.isArray(recipientVendors) ? recipientVendors : [recipientVendors])];
    if (vIds.length > 0) {
      const vendorDocs = vIds.map((vId) => ({
        vendor: vId,
        title,
        message,
        type: type === "system" ? "GENERAL" : type.toUpperCase(),
        data,
        isRead: false,
      }));

      VendorNotification.insertMany(vendorDocs, { ordered: false }).catch(() => {});

      // Sockets for vendors
      vIds.forEach((vId) => {
        emitVendorNotification(vId.toString(), notifPayload);
      });
    }

    // 3. Socket broadcast for roles if provided
    if (recipientRoles.length > 0 && io) {
      if (recipientRoles.includes("admin") || recipientRoles.includes("superadmin")) {
        io.to("role:admin").emit("staff:notification", {
          title,
          message,
          eventType: type,
          data,
        });
      }
      if (recipientRoles.includes("customer")) {
        io.emit("notification:broadcast", notifPayload);
      }
    }

    // 4. Asynchronous Push Notification Delivery
    const pushPromises = [];

    if (userIds.length > 0) {
      pushPromises.push(
        sendPushToUsers({
          userIds,
          title,
          body: message,
          data,
          channelId,
          sound,
          priority,
        })
      );
    }

    if (vIds.length > 0) {
      pushPromises.push(
        sendPushToVendors({
          vendorIds: vIds,
          title,
          body: message,
          data,
          channelId,
          sound,
          priority,
        })
      );
    }

    if (recipientDelivery && recipientDelivery.length) {
      pushPromises.push(
        sendPushToDeliveryPartners({
          deliveryBoyIds: recipientDelivery,
          title,
          body: message,
          data,
          channelId: "delivery",
          sound,
          priority,
        })
      );
    }

    if (recipientRoles && recipientRoles.length) {
      pushPromises.push(
        sendPushToRoles({
          roles: recipientRoles,
          title,
          body: message,
          data,
          channelId: "broadcasts",
          sound,
          priority,
        })
      );
    }

    const results = await Promise.all(pushPromises);
    const totalPushesSent = results.reduce((acc, curr) => acc + (curr?.sentCount || 0), 0);

    return {
      success: true,
      deliveredPushCount: totalPushesSent,
    };
  } catch (err) {
    console.error("[PushService] dispatchMarketplaceNotification error:", err.message);
    return { success: false, error: err.message };
  }
};

export default {
  sendPushToUsers,
  sendPushToVendors,
  sendPushToDeliveryPartners,
  sendPushToRoles,
  dispatchExpoPushChunks,
  dispatchMarketplaceNotification,
};

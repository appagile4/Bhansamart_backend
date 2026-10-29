import Notification from "../models/Notification.js";
import { emitToCustomerNotification } from "../socket/socketManager.js";
import { sendPushToUsers } from "./pushNotificationService.js";

/**
 * Core helper to safely persist an in-app customer notification,
 * emit real-time Socket.IO event to the customer's personal room,
 * and dispatch an Expo Push Notification with strict idempotency protection.
 */
export const createCustomerNotification = async ({
  customerId,
  title,
  message,
  type = "order",
  category = "orders",
  data = {},
  idempotencyKey = null,
}) => {
  try {
    if (!customerId) return null;
    const cId = customerId.toString();

    // Idempotency check: prevent duplicate notifications from network retries or repeated calls
    if (idempotencyKey) {
      const existing = await Notification.findOne({ idempotencyKey });
      if (existing) {
        console.log(`[CustomerNotification] Duplicate skipped for idempotencyKey: ${idempotencyKey}`);
        return existing;
      }
    }

    const notification = await Notification.create({
      user: cId,
      targetRole: "customer",
      title,
      message,
      type,
      category,
      data,
      idempotencyKey,
      isRead: false,
    });

    // 1. Real-time private socket emission to customer room
    emitToCustomerNotification(cId, notification);

    // 2. High-priority Expo push notification
    sendPushToUsers({
      userIds: [cId],
      title,
      body: message,
      data: {
        ...data,
        notificationId: notification._id.toString(),
        type,
        category,
        screen: data.screen || "OrderTrackingScreen",
      },
      channelId: "orders",
      sound: "default",
      priority: "high",
    }).catch((pushErr) => {
      console.warn("[CustomerNotification Push Warning]:", pushErr.message);
    });

    return notification;
  } catch (err) {
    if (err.code === 11000) {
      // Mongo unique index violation on idempotencyKey: gracefully ignore
      console.log(`[CustomerNotification] Duplicate key caught for ${idempotencyKey}`);
      return null;
    }
    console.error("[createCustomerNotification Error]:", err);
    return null;
  }
};

/**
 * 1. Order Placed Successfully
 * Notify customer immediately after the backend successfully creates the order.
 */
export const notifyCustomerOrderPlaced = async (order) => {
  try {
    const customerId = order.customer?._id || order.customer;
    if (!customerId) return null;

    const orderNumber = order.orderNumber || order._id;
    const storeName =
      order.vendor?.businessDetails?.businessName ||
      order.vendor?.brandDetails?.brandName ||
      "the store";
    const idempotencyKey = `CUST-NOTIF-PLACED-${order._id}`;

    return await createCustomerNotification({
      customerId,
      title: "Order Placed Successfully! 🎉",
      message: `Your order #${orderNumber} has been received and sent to ${storeName}.`,
      type: "order",
      category: "orders",
      data: {
        orderId: order._id.toString(),
        orderNumber,
        totalAmount: order.totalAmount,
        screen: "OrderTrackingScreen",
        event: "ORDER_PLACED",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerOrderPlaced Error]:", err);
    return null;
  }
};

/**
 * 2. Order Picked Up
 * Notify the customer when the delivery boy successfully picks up the order from the vendor.
 */
export const notifyCustomerOrderPickedUp = async (order, deliveryBoy = null) => {
  try {
    const customerId = order.customer?._id || order.customer;
    if (!customerId) return null;

    const orderNumber = order.orderNumber || order._id;
    const storeName =
      order.vendor?.businessDetails?.businessName ||
      order.vendor?.brandDetails?.brandName ||
      "the store";
    const riderName = deliveryBoy?.fullName || "your delivery partner";
    const idempotencyKey = `CUST-NOTIF-PICKED-${order._id}`;

    return await createCustomerNotification({
      customerId,
      title: "Order Picked Up! 🛵",
      message: `Your order #${orderNumber} has been collected from ${storeName} by ${riderName}.`,
      type: "order",
      category: "orders",
      data: {
        orderId: order._id.toString(),
        orderNumber,
        deliveryBoyName: riderName,
        screen: "OrderTrackingScreen",
        event: "ORDER_PICKED_UP",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerOrderPickedUp Error]:", err);
    return null;
  }
};

/**
 * 3. Out for Delivery
 * Notify the customer when the delivery boy marks the order as out for delivery.
 */
export const notifyCustomerOrderOutForDelivery = async (order, deliveryBoy = null) => {
  try {
    const customerId = order.customer?._id || order.customer;
    if (!customerId) return null;

    const orderNumber = order.orderNumber || order._id;
    const riderName = deliveryBoy?.fullName || "our delivery partner";
    const idempotencyKey = `CUST-NOTIF-OFD-${order._id}`;

    return await createCustomerNotification({
      customerId,
      title: "Out for Delivery! 🛵",
      message: `Your order #${orderNumber} is on the way with ${riderName} and will arrive shortly!`,
      type: "order",
      category: "orders",
      data: {
        orderId: order._id.toString(),
        orderNumber,
        deliveryBoyName: riderName,
        screen: "OrderTrackingScreen",
        event: "OUT_FOR_DELIVERY",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerOrderOutForDelivery Error]:", err);
    return null;
  }
};

/**
 * 4. Order Delivered Successfully
 * Notify the customer when the order is successfully delivered.
 */
export const notifyCustomerOrderDelivered = async (order) => {
  try {
    const customerId = order.customer?._id || order.customer;
    if (!customerId) return null;

    const orderNumber = order.orderNumber || order._id;
    const storeName =
      order.vendor?.businessDetails?.businessName ||
      order.vendor?.brandDetails?.brandName ||
      "BhansaMart";
    const idempotencyKey = `CUST-NOTIF-DELIVERED-${order._id}`;

    return await createCustomerNotification({
      customerId,
      title: "Order Delivered Successfully! 📦",
      message: `Your order #${orderNumber} from ${storeName} has been delivered. Enjoy your items!`,
      type: "order",
      category: "orders",
      data: {
        orderId: order._id.toString(),
        orderNumber,
        screen: "OrderTrackingScreen",
        event: "ORDER_DELIVERED",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerOrderDelivered Error]:", err);
    return null;
  }
};

/**
 * 5. Order Cancelled
 * Notify the customer when the order is cancelled.
 */
export const notifyCustomerOrderCancelled = async (order, reason = "") => {
  try {
    const customerId = order.customer?._id || order.customer;
    if (!customerId) return null;

    const orderNumber = order.orderNumber || order._id;
    const storeName =
      order.vendor?.businessDetails?.businessName ||
      order.vendor?.brandDetails?.brandName ||
      "";
    const reasonText = reason ? ` Reason: ${reason}` : "";
    const storeText = storeName ? ` from ${storeName}` : "";
    const idempotencyKey = `CUST-NOTIF-CANCELLED-${order._id}`;

    return await createCustomerNotification({
      customerId,
      title: "Order Cancelled",
      message: `Your order #${orderNumber}${storeText} has been cancelled.${reasonText}`,
      type: "order",
      category: "orders",
      data: {
        orderId: order._id.toString(),
        orderNumber,
        reason: reason || "",
        screen: "OrderTrackingScreen",
        event: "ORDER_CANCELLED",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerOrderCancelled Error]:", err);
    return null;
  }
};

/**
 * 6. Refund Status Updated
 * Notify the customer when a relevant refund status changes.
 */
export const notifyCustomerRefundStatusUpdated = async (
  order,
  refund,
  newStatus = "",
  extraNotes = ""
) => {
  try {
    const customerId =
      order?.customer?._id || order?.customer || refund?.customer;
    if (!customerId) return null;

    const orderNumber = order?.orderNumber || refund?.orderNumber || (order?._id ? order._id.toString() : "");
    const refundNumber = refund?.refundNumber || (refund?._id ? refund._id.toString() : "");
    const amount = refund?.amount || order?.totalAmount || 0;
    const statusUpper = (newStatus || refund?.status || "UPDATED").toUpperCase();

    const idempotencyKey = `CUST-NOTIF-REFUND-${refund?._id || order?._id}-${statusUpper}`;

    let title = `Refund Status Updated: #${orderNumber}`;
    let message = `The refund status for order #${orderNumber} is now ${statusUpper.replace(/_/g, " ")}.`;

    if (statusUpper === "REQUESTED" || statusUpper === "VENDOR_REVIEW") {
      title = `Refund Request Received: #${orderNumber}`;
      message = `Your refund request for NPR ${amount} on order #${orderNumber} has been received and is under review.`;
    } else if (statusUpper === "APPROVED" || statusUpper === "STAFF_EXAMINING") {
      title = `Refund Approved: #${orderNumber}`;
      message = `Your refund of NPR ${amount} for order #${orderNumber} has been approved.`;
    } else if (statusUpper === "COMPLETED" || statusUpper === "REFUNDED") {
      title = `Refund Completed Successfully! 💰`;
      message = `Refund of NPR ${amount} for order #${orderNumber} has been processed successfully.${extraNotes ? " " + extraNotes : ""}`;
    } else if (statusUpper === "PROCESSING") {
      title = `Refund In Process: #${orderNumber}`;
      message = `Your refund of NPR ${amount} for order #${orderNumber} is currently being processed.`;
    } else if (statusUpper === "REJECTED" || statusUpper === "VENDOR_REJECTED") {
      title = `Refund Request Rejected: #${orderNumber}`;
      const rejReason =
        extraNotes || refund?.rejectionReason || "Could not be approved";
      message = `Your refund request for order #${orderNumber} was not approved. Reason: ${rejReason}`;
    }

    return await createCustomerNotification({
      customerId,
      title,
      message,
      type: "refund",
      category: "refunds",
      data: {
        orderId: order?._id ? order._id.toString() : (refund?.order ? refund.order.toString() : ""),
        orderNumber,
        refundId: refund?._id ? refund._id.toString() : "",
        refundNumber,
        amount,
        status: statusUpper,
        screen: "OrderTrackingScreen",
        event: "REFUND_STATUS_UPDATED",
      },
      idempotencyKey,
    });
  } catch (err) {
    console.error("[notifyCustomerRefundStatusUpdated Error]:", err);
    return null;
  }
};

export default {
  createCustomerNotification,
  notifyCustomerOrderPlaced,
  notifyCustomerOrderPickedUp,
  notifyCustomerOrderOutForDelivery,
  notifyCustomerOrderDelivered,
  notifyCustomerOrderCancelled,
  notifyCustomerRefundStatusUpdated,
};

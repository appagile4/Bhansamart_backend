import Notification from "../models/Notification.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Create an in-app notification record
 */
export const createNotification = async ({
  userId,
  title,
  message,
  type = "system",
  data = {},
  idempotencyKey = null,
  session = null,
}) => {
  if (idempotencyKey) {
    const existing = await Notification.findOne({ idempotencyKey }).session(
      session
    );
    if (existing) return existing;
  }

  const [notification] = await Notification.create(
    [
      {
        user: userId,
        title,
        message,
        type,
        data,
        idempotencyKey,
        outboxStatus: "PENDING",
      },
    ],
    { session }
  );

  return notification;
};

/**
 * Fetch paginated customer notifications
 */
export const getCustomerNotifications = async (
  userId,
  { page = 1, limit = 20, isRead = null } = {}
) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query = { user: userId };
  if (isRead !== null && isRead !== undefined) {
    query.isRead = isRead === "true" || isRead === true;
  }

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ user: userId, isRead: false }),
  ]);

  return {
    notifications,
    total,
    totalPages: Math.ceil(total / limitNum) || 1,
    currentPage: pageNum,
    unreadCount,
  };
};

/**
 * Mark a single notification as read (with strict user ownership verification)
 */
export const markNotificationRead = async (notificationId, userId) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, user: userId },
    { isRead: true, readAt: new Date() },
    { returnDocument: "after" }
  );

  if (!notification) {
    throw new AppError("Notification not found or access denied", 404);
  }

  return notification;
};

/**
 * Mark all notifications as read for user
 */
export const markAllNotificationsRead = async (userId) => {
  const result = await Notification.updateMany(
    { user: userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );

  return {
    success: true,
    modifiedCount: result.modifiedCount,
  };
};

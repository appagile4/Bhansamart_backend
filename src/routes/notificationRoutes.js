import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
} from "../controllers/notificationController.js";

const router = express.Router();

// All notification routes require authenticated session
router.use(protect);

// 1. Device Token Registration & Cleanup
router.post("/devices/register", registerDeviceToken);
router.post("/devices/unregister", unregisterDeviceToken);

// 2. User Inboxes & Read Receipts
router.get("/my", getMyNotifications);
router.get("/unread-count", getUnreadNotificationCount);
router.patch("/:id/read", markNotificationAsRead);
router.patch("/read-all", markAllNotificationsAsRead);

export default router;

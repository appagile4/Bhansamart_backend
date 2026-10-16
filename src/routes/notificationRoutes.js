import express from "express";
import {
  getCustomerNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../controllers/referralController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", getCustomerNotifications);
router.patch("/read-all", markAllNotificationsAsRead);
router.patch("/:id/read", markNotificationAsRead);

export default router;

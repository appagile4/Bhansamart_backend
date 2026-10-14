import express from "express";
import {
  toggleAvailability,
  getAvailabilityStatus,
  updateGpsLocation,
} from "../controllers/deliveryLocationController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.patch("/availability/toggle", toggleAvailability);
router.get("/availability/status", getAvailabilityStatus);
router.post("/location/update", updateGpsLocation);

export default router;

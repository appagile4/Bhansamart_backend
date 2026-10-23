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
router.patch("/toggle", toggleAvailability);
router.patch("/", toggleAvailability);

router.get("/availability/status", getAvailabilityStatus);
router.get("/status", getAvailabilityStatus);
router.get("/", getAvailabilityStatus);

router.post("/location/update", updateGpsLocation);
router.post("/update", updateGpsLocation);
router.post("/", updateGpsLocation);

export default router;

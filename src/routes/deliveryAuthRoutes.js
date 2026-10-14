import express from "express";
import {
  registerDeliveryBoy,
  loginDeliveryBoy,
  getMyDeliveryProfile,
  updateDeliveryProfile,
} from "../controllers/deliveryAuthController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", registerDeliveryBoy);
router.post("/login", loginDeliveryBoy);

// Protected routes
router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.get("/me", getMyDeliveryProfile);
router.put("/me", updateDeliveryProfile);

export default router;

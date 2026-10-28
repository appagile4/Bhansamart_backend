import express from "express";
import {
  getActiveAssignment,
  acceptAssignment,
  rejectAssignment,
  markArrivedAtStore,
  verifyPickupOtp,
  markArrivedAtCustomer,
  verifyDeliveryOtp,
  cancelActiveDelivery,
  getAssignedReturnPickups,
} from "../controllers/deliveryAssignmentController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.get("/active", getActiveAssignment);
router.get("/return-pickups", getAssignedReturnPickups);
router.post("/:assignmentId/accept", acceptAssignment);
router.post("/:assignmentId/reject", rejectAssignment);
router.post("/:orderId/arrived-store", markArrivedAtStore);
router.post("/:orderId/verify-pickup-otp", verifyPickupOtp);
router.post("/:orderId/arrived-customer", markArrivedAtCustomer);
router.post("/:orderId/verify-delivery-otp", verifyDeliveryOtp);
router.post("/:orderId/cancel-delivery", cancelActiveDelivery);

export default router;

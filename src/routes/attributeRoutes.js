import { Router } from "express";
import {
  getAttributes,
  createAttribute,
} from "../controllers/attributeController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = Router();

// Public / Authenticated read
router.get("/", getAttributes);

// Vendor Protected create / update
router.post(
  "/",
  protect,
  authorizeRoles("vendor", "admin"),
  createAttribute
);

export default router;

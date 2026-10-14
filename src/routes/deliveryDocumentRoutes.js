import express from "express";
import {
  uploadOrUpdateDocument,
  getDocumentStatus,
} from "../controllers/deliveryDocumentController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.post("/upload", uploadOrUpdateDocument);
router.get("/status", getDocumentStatus);

export default router;

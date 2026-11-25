import express from "express";
import {
  uploadOrUpdateDocument,
  getDocumentStatus,
} from "../controllers/deliveryDocumentController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/uploadMiddleware.js";
import { requireMinImageSize } from "../middleware/imageSizeMiddleware.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("delivery_boy", "admin", "superadmin"));

router.post(
  "/upload",
  upload.fields([
    { name: "frontImage", maxCount: 1 },
    { name: "backImage", maxCount: 1 },
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  requireMinImageSize("document", ["frontImageBase64", "backImageBase64"]),
  uploadOrUpdateDocument
);
router.get("/status", getDocumentStatus);

export default router;

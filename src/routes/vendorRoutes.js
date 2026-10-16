import { Router } from "express";
import {
  getMyVendor,
  updateVendorSection,
  uploadVendorLogo,
  getApprovedVendors,
  updateDeliveryRadius,
  updateStoreStatus,
  getNearbyVendors,
  getVendorCustomers,
} from "../controllers/vendorController.js";
import {
  getDashboardStats,
  getVendorTransactions,
  requestWithdrawal,
  getVendorNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getCodDueByRiders,
  confirmCodHandover,
  getPaymentQrSettings,
  updatePaymentQrSettings,
  uploadPaymentQrImage,
} from "../controllers/vendorFinanceController.js";
import {
  createBrandRequest,
  getMyBrandRequests,
} from "../controllers/brandController.js";
import { createAttribute } from "../controllers/attributeController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

const router = Router();

// Public routes
router.get("/approved", getApprovedVendors);
router.get("/nearby", getNearbyVendors);

// Protected vendor routes
router.use(protect, authorizeRoles("vendor", "admin"));

// Profile & Settings
router.get("/profile", getMyVendor);
router.put("/update-section", updateVendorSection);
router.post("/upload-logo", uploadSingleImage("logo"), uploadVendorLogo);
router.put("/delivery-radius", updateDeliveryRadius);
router.put("/store-status", updateStoreStatus);

// Dashboard Live Stats
router.get("/dashboard/stats", getDashboardStats);

// Customers
router.get("/customers", getVendorCustomers);

// Transactions & Wallet
router.get("/transactions", getVendorTransactions);
router.post("/wallet/withdraw", requestWithdrawal);

// Notifications
router.get("/notifications", getVendorNotifications);
router.patch("/notifications/read-all", markAllNotificationsRead);
router.patch("/notifications/:id/read", markNotificationRead);

// Cash on Delivery (COD) Store Handover
router.get("/cod/due-by-riders", getCodDueByRiders);
router.post("/cod/confirm-handover", confirmCodHandover);

// Payment QR Code & UPI Config
router.get("/payment-qr", getPaymentQrSettings);
router.put("/payment-qr", updatePaymentQrSettings);
router.post("/payment-qr/upload", uploadSingleImage("qrCode"), uploadPaymentQrImage);

// Vendor Brand Requests & Submissions
router.get("/brand-requests", getMyBrandRequests);
router.post(
  "/brand-requests",
  uploadSingleImage("logo"),
  createBrandRequest
);

// Vendor Attributes Management
router.post("/attributes", createAttribute);

export default router;

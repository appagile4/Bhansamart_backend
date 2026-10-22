import express from "express";
import {
  getAdminDashboardStats,
  getDashboardCharts,
  getAllVendorsAdmin,
  getVendorDetailsAdmin,
  updateVendorVerificationAdmin,
  getAllAdmins,
  createAdminAccount,
  updateAdminAccount,
  getAllCustomersAdmin,
  getAllDeliveryBoysAdmin,
  getCategoriesAdmin,
  createCategoryAdmin,
  updateCategoryAdmin,
  getAllProductsAdmin,
  moderateProductAdmin,
  getAllFinancialTransactions,
  getAllWithdrawalsAdmin,
  reviewWithdrawalAdmin,
  getPlatformPaymentConfigAdmin,
  updatePlatformPaymentConfigAdmin,
  getActiveCheckoutPaymentMethods,
  getAllTicketsAdmin,
  getTicketDetailsAdmin,
  replyToTicketAdmin,
  sendTargetedNotificationAdmin,
  getLiveOperationalMapData,
  getAuditLogsAdmin,
} from "../controllers/adminManagementController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import {
  enforceAdminVendorScope,
  requireSuperadminOnly,
} from "../middleware/adminVendorScopeMiddleware.js";

const router = express.Router();

// Public / Customer Checkout payment options
router.get("/checkout/payment-methods", getActiveCheckoutPaymentMethods);

// ── Management Protected Barrier (Requires Authenticated Admin or Superadmin) ──
router.use(protect);
router.use(authorizeRoles("admin", "superadmin"));
router.use(enforceAdminVendorScope);

// 1. Dashboard Overview & Real-Time Stats
router.get("/dashboard/stats", getAdminDashboardStats);
router.get("/dashboard/charts", getDashboardCharts);

// 2. Vendor Management
router.get("/vendors", getAllVendorsAdmin);
router.get("/vendors/:id", getVendorDetailsAdmin);
router.patch("/vendors/:id/verification", updateVendorVerificationAdmin);

// 3. Admin Management (Superadmin Only)
router.get("/admins", requireSuperadminOnly, getAllAdmins);
router.post("/admins", requireSuperadminOnly, createAdminAccount);
router.put("/admins/:id", requireSuperadminOnly, updateAdminAccount);

// 4. Customer Management
router.get("/customers", getAllCustomersAdmin);

// 5. Delivery Boy Management & Monitoring
router.get("/delivery-boys", getAllDeliveryBoysAdmin);

// 6. Catalog (Categories & Products)
router.get("/categories", getCategoriesAdmin);
router.post("/categories", createCategoryAdmin);
router.put("/categories/:id", updateCategoryAdmin);
router.get("/products", getAllProductsAdmin);
router.patch("/products/:id/moderate", moderateProductAdmin);

// 7. Support Tickets
router.get("/tickets", getAllTicketsAdmin);
router.get("/tickets/:id", getTicketDetailsAdmin);
router.post("/tickets/:id/reply", replyToTicketAdmin);

// 8. Targeted Notifications
router.post("/notifications/send", sendTargetedNotificationAdmin);

// 9. Live Operational Map
router.get("/map/live-data", getLiveOperationalMapData);

// 10. Financial Management (Superadmin Only)
router.get("/finance/transactions", requireSuperadminOnly, getAllFinancialTransactions);
router.get("/finance/withdrawals", requireSuperadminOnly, getAllWithdrawalsAdmin);
router.post("/finance/withdrawals/:id/review", requireSuperadminOnly, reviewWithdrawalAdmin);

// 11. Platform Bank Account & Checkout Display Configuration (Superadmin Only)
router.get("/platform-payment/config", requireSuperadminOnly, getPlatformPaymentConfigAdmin);
router.put("/platform-payment/config", requireSuperadminOnly, updatePlatformPaymentConfigAdmin);

// 12. Security & System Audit Trail (Superadmin Only)
router.get("/audit-logs", requireSuperadminOnly, getAuditLogsAdmin);

export default router;

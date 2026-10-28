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
  uploadCategoryImageAdmin,
  getAllProductsAdmin,
  getProductDetailsAdmin,
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
  searchNotificationRecipientsAdmin,
  getTargetedNotificationHistoryAdmin,
  getLiveOperationalMapData,
  getAuditLogsAdmin,
} from "../controllers/adminManagementController.js";
import {
  getMyAssignedVendors,
  getStaffDashboardOverview,
  getStaffOrders,
  getVendorSalesAnalytics,
  getVendorProductsAnalytics,
  getDeliveryAssignmentsAdmin,
  getDeliveryBoyProfileAdmin,
  getDeliveryCodReconciliationAdmin,
  raiseCodDisputeAdmin,
  getVendorWithdrawalsAdmin,
  examineVendorWithdrawalAdmin,
  getBrandsReviewQueueAdmin,
  reviewBrandAdmin,
  getRefundsQueueAdmin,
  staffExamineRefundAction,
  updateRefundPickupAction,
  recordRefundInspectionAction,
  finalizeRefundPayoutAction,
  getStaffNotificationsAdmin,
  markStaffNotificationRead,
  getCustomerDetailsAdmin,
} from "../controllers/staffAdminOperationsController.js";
import {
  getBroadcastPermissions,
  getBroadcastEligibleVendors,
  getBroadcastRecipientPreview,
  sendVendorBroadcast,
  getBroadcastHistory,
} from "../controllers/vendorBroadcastController.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import {
  enforceAdminVendorScope,
  requireSuperadminOnly,
} from "../middleware/adminVendorScopeMiddleware.js";
import { uploadSingleImage } from "../middleware/uploadMiddleware.js";

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
router.get("/customers/:id", getCustomerDetailsAdmin);
router.get("/staff-operations/customers/:id", getCustomerDetailsAdmin);

// 5. Delivery Boy Management & Monitoring
router.get("/delivery-boys", getAllDeliveryBoysAdmin);

// 6. Catalog (Categories & Products)
router.get("/categories", getCategoriesAdmin);
router.post("/categories/upload-image", uploadSingleImage("image"), uploadCategoryImageAdmin);
router.post("/categories", createCategoryAdmin);
router.put("/categories/:id", updateCategoryAdmin);
router.get("/products", getAllProductsAdmin);
router.get("/products/:id", getProductDetailsAdmin);
router.patch("/products/:id/moderate", moderateProductAdmin);

// 7. Support Tickets
router.get("/tickets", getAllTicketsAdmin);
router.get("/tickets/:id", getTicketDetailsAdmin);
router.post("/tickets/:id/reply", replyToTicketAdmin);

// 8. Targeted Notifications
router.post("/notifications/send", sendTargetedNotificationAdmin);
router.get("/notifications/search-recipients", searchNotificationRecipientsAdmin);
router.get("/notifications/history", getTargetedNotificationHistoryAdmin);

// 8.1 Vendor Broadcast Notifications (Staff & Super Admin with Granular RBAC)
router.get("/broadcasts/permissions", getBroadcastPermissions);
router.get("/broadcasts/eligible-vendors", getBroadcastEligibleVendors);
router.get("/broadcasts/recipient-preview", getBroadcastRecipientPreview);
router.post("/broadcasts/send", sendVendorBroadcast);
router.get("/broadcasts/history", getBroadcastHistory);

// 9. Live Operational Map
router.get("/map/live-data", getLiveOperationalMapData);

// 10. Financial Management (Superadmin Only)
router.get("/finance/transactions", requireSuperadminOnly, getAllFinancialTransactions);
router.get("/finance/withdrawals", requireSuperadminOnly, getAllWithdrawalsAdmin);
router.post("/finance/withdrawals/:id/review", requireSuperadminOnly, reviewWithdrawalAdmin);
router.get("/finance/cod-reporting", requireSuperadminOnly, getDeliveryCodReconciliationAdmin);

// 11. Platform Bank Account & Checkout Display Configuration (Superadmin Only)
router.get("/platform-payment/config", requireSuperadminOnly, getPlatformPaymentConfigAdmin);
router.put("/platform-payment/config", requireSuperadminOnly, updatePlatformPaymentConfigAdmin);

// 12. Security & System Audit Trail (Superadmin Only)
router.get("/audit-logs", requireSuperadminOnly, getAuditLogsAdmin);

// ── 13. StaffAdmin Operations, Vendor Management & Refund Workflow ──
router.get("/staff-operations/dashboard-overview", getStaffDashboardOverview);
router.get("/staff-operations/assigned-vendors", getMyAssignedVendors);
router.get("/staff-operations/orders", getStaffOrders);

// Sales & Product Analytics (supports query param ?vendorId=... or path param :vendorId)
router.get("/staff-operations/sales-analytics", getVendorSalesAnalytics);
router.get("/staff-operations/vendors/:vendorId/analytics", getVendorSalesAnalytics);
router.get("/staff-operations/products-analytics", getVendorProductsAnalytics);
router.get("/staff-operations/vendors/:vendorId/products-analytics", getVendorProductsAnalytics);

// Delivery Assignments, Profiles & COD Reconciliation
router.get("/staff-operations/delivery-assignments", getDeliveryAssignmentsAdmin);
router.get("/staff-operations/delivery/assignments", getDeliveryAssignmentsAdmin);
router.get("/staff-operations/delivery-boy-profile/:id", getDeliveryBoyProfileAdmin);
router.get("/staff-operations/delivery/boys/:id", getDeliveryBoyProfileAdmin);
router.get("/staff-operations/delivery-cod-reconciliation", getDeliveryCodReconciliationAdmin);
router.get("/staff-operations/delivery/cod-reconciliation", getDeliveryCodReconciliationAdmin);
router.post("/staff-operations/delivery-cod-dispute", raiseCodDisputeAdmin);
router.post("/staff-operations/delivery/cod-dispute", raiseCodDisputeAdmin);

// Vendor Withdrawals
router.get("/staff-operations/withdrawals", getVendorWithdrawalsAdmin);
router.patch("/staff-operations/withdrawals/:id/examine", examineVendorWithdrawalAdmin);

// Brand Review Queue
router.get("/staff-operations/brands-queue", getBrandsReviewQueueAdmin);
router.get("/staff-operations/brands", getBrandsReviewQueueAdmin);
router.patch("/staff-operations/brands-queue/:id/review", reviewBrandAdmin);
router.patch("/staff-operations/brands/:id/review", reviewBrandAdmin);

// Refund & Returns Lifecycle
router.get("/staff-operations/refunds-queue", getRefundsQueueAdmin);
router.get("/staff-operations/refunds", getRefundsQueueAdmin);
router.patch("/staff-operations/refunds/:id/examine", staffExamineRefundAction);
router.patch("/staff-operations/refunds/:id/pickup", updateRefundPickupAction);
router.patch("/staff-operations/refunds/:id/inspection", recordRefundInspectionAction);
router.patch("/staff-operations/refunds/:id/finalize-payout", requireSuperadminOnly, finalizeRefundPayoutAction);

// Real-Time Notifications
router.get("/staff-operations/notifications", getStaffNotificationsAdmin);
router.patch("/staff-operations/notifications/:id/read", markStaffNotificationRead);

export default router;

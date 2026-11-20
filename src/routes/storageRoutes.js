import { Router } from "express";
import {
  getMyStorage,
  getStoragePlans,
  createStorageRecharge,
  getMyStorageRecharges,
  listVendorStorage,
  getVendorStorageDetail,
  setVendorQuota,
  listStorageRecharges,
  reviewStorageRecharge,
} from "../controllers/storageController.js";

/**
 * Vendor image-storage routes.
 * Mounted in vendorRoutes (already behind protect + vendor role) and adminRoutes (behind protect +
 * admin role + requireSuperadminOnly), so these routers add no auth of their own.
 */

// /api/vendor/storage/*
export const vendorStorageRouter = Router();
vendorStorageRouter.get("/", getMyStorage);
vendorStorageRouter.get("/plans", getStoragePlans);
vendorStorageRouter.get("/recharges", getMyStorageRecharges);
vendorStorageRouter.post("/recharge", createStorageRecharge);

// /api/admin/storage/*  (super admin only)
export const adminStorageRouter = Router();
adminStorageRouter.get("/vendors", listVendorStorage);
adminStorageRouter.get("/vendors/:vendorId", getVendorStorageDetail);
adminStorageRouter.patch("/vendors/:vendorId/quota", setVendorQuota);
adminStorageRouter.get("/recharges", listStorageRecharges);
adminStorageRouter.patch("/recharges/:id", reviewStorageRecharge);

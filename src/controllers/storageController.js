import mongoose from "mongoose";
import Vendor from "../models/Vendor.js";
import VendorStorage from "../models/VendorStorage.js";
import StorageAsset from "../models/StorageAsset.js";
import StorageRecharge from "../models/StorageRecharge.js";
import VendorNotification from "../models/VendorNotification.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { emitVendorNotification, getIO } from "../socket/socketManager.js";
import { getVendorUsage, ensureVendorUsage, syncAlertLevel, formatBytes } from "../utils/storageQuota.js";
import { getPaymentProvider } from "../utils/payments/index.js";
import { DEFAULT_VENDOR_QUOTA_BYTES, STORAGE_ALERT_LEVELS, STORAGE_PLANS, findStoragePlan, GB } from "../config/storagePlans.js";

/*
 * Vendor image storage: usage, mock recharges (super admin verifies), and the super admin overview.
 * Reads the existing Vendor collection; writes only the new storage collections
 * (+ normal SYSTEM vendor notifications and audit-log entries).
 */

const pctOf = (used, quota) => (quota > 0 ? Math.round((used / quota) * 1000) / 10 : 100);
const vendorName = (v) => v?.businessDetails?.businessName || v?.brandDetails?.brandName || v?.sellerDetails?.sellerName || "Store";

const getMyVendorOrThrow = async (userId) => {
  const vendor = await Vendor.findOne({ userId }).select("_id businessDetails brandDetails sellerDetails").lean();
  if (!vendor) throw new AppError("Vendor profile not found for authenticated user", 404);
  return vendor;
};

const notifyVendor = async (vendorId, title, message, data = {}) => {
  try {
    const notif = await VendorNotification.create({ vendor: vendorId, type: "SYSTEM", title, message, data });
    emitVendorNotification(vendorId, notif);
  } catch (error) {
    console.warn("[Storage] Vendor notification failed:", error.message);
  }
};

/**
 * Tell every super admin (only — storage is super-admin-only) that a vendor submitted a storage payment.
 * Saved as a normal "staff_alert" Notification (shows in the super admin Notifications → Alerts list) and
 * pushed live to the `role:superadmin` socket room. Never throws.
 */
const notifySuperadminsOfRecharge = async (recharge, vendor) => {
  try {
    const name = vendorName(vendor);
    const title = "New storage payment to verify";
    const message = `${name} paid ${recharge.currency} ${recharge.amount} for ${recharge.planName}${recharge.paymentRef ? ` (ref ${recharge.paymentRef})` : ""}. Verify the payment before approving.`;
    const data = { kind: "STORAGE_RECHARGE", rechargeId: recharge._id, vendorId: vendor._id, amount: recharge.amount, currency: recharge.currency, paymentRef: recharge.paymentRef };
    const admins = await User.find({ role: "superadmin", isActive: true }).select("_id").lean();
    await Promise.all(admins.map((a) => Notification.create({ user: a._id, title, message, type: "staff_alert", data }).catch(() => null)));
    try {
      getIO().to("role:superadmin").emit("storage_recharge_requested", { title, message, data, timestamp: new Date() });
    } catch {
      /* socket not initialised (tests / scripts) */
    }
  } catch (error) {
    console.warn("[Storage] Super admin recharge alert failed:", error.message);
  }
};

const audit = async (req, action, targetId, changes, details) => {
  try {
    await AuditLog.create({
      actor: req.user._id,
      actorName: req.user.name,
      actorEmail: req.user.email,
      actorRole: req.user.role === "superadmin" ? "superadmin" : "admin",
      action,
      targetResource: "VendorStorage",
      targetId,
      changes,
      details,
    });
  } catch (error) {
    console.warn("[Storage] Audit log failed:", error.message);
  }
};

const breakdownFor = async (vendorId) => {
  const rows = await StorageAsset.aggregate([
    { $match: { vendor: new mongoose.Types.ObjectId(String(vendorId)), status: "active" } },
    { $group: { _id: "$kind", bytes: { $sum: "$bytes" }, count: { $sum: 1 } } },
    { $sort: { bytes: -1 } },
  ]);
  return rows.map((r) => ({ kind: r._id, bytes: r.bytes, count: r.count }));
};

const usagePayload = (usage) => ({
  usedBytes: usage.usedBytes,
  quotaBytes: usage.quotaBytes,
  freeBytes: Math.max(0, usage.quotaBytes - usage.usedBytes),
  percent: pctOf(usage.usedBytes, usage.quotaBytes),
  assetCount: usage.assetCount || 0,
  alertLevels: STORAGE_ALERT_LEVELS,
  isFull: usage.usedBytes >= usage.quotaBytes,
});

// ─── Vendor ────────────────────────────────────────────────────────────────

/** GET /api/vendor/storage */
export const getMyStorage = async (req, res, next) => {
  try {
    const vendor = await getMyVendorOrThrow(req.user._id);
    const [usage, breakdown, largest, pendingRecharge] = await Promise.all([
      getVendorUsage(vendor._id),
      breakdownFor(vendor._id),
      StorageAsset.find({ vendor: vendor._id, status: "active" }).sort({ bytes: -1 }).limit(10).select("url bytes kind createdAt").lean(),
      StorageRecharge.findOne({ vendor: vendor._id, status: { $in: ["PENDING", "PAID"] } }).sort({ createdAt: -1 }).lean(),
    ]);
    res.status(200).json({
      success: true,
      data: { ...usagePayload(usage), breakdown, largest, pendingRecharge, countsNewUploadsOnly: true },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/vendor/storage/plans */
export const getStoragePlans = async (req, res) => {
  const provider = getPaymentProvider();
  res.status(200).json({
    success: true,
    data: { plans: STORAGE_PLANS, paymentProvider: provider.name, requiresAdminApproval: provider.requiresAdminApproval !== false },
  });
};

/** POST /api/vendor/storage/recharge  { planId, paymentRef?, note? } */
export const createStorageRecharge = async (req, res, next) => {
  try {
    const vendor = await getMyVendorOrThrow(req.user._id);
    const plan = findStoragePlan(req.body?.planId);
    if (!plan) return next(new AppError("Please choose a valid storage plan.", 400));

    const pending = await StorageRecharge.findOne({ vendor: vendor._id, status: { $in: ["PENDING", "PAID"] } }).lean();
    if (pending) {
      return next(new AppError("You already have a storage recharge awaiting verification. Please wait for it to be reviewed.", 409));
    }

    const provider = getPaymentProvider();
    const payment = await provider.initiate({ amount: plan.amount, currency: plan.currency, reference: req.body?.paymentRef });

    const recharge = await StorageRecharge.create({
      vendor: vendor._id,
      requestedBy: req.user._id,
      planId: plan.id,
      planName: plan.name,
      extraBytes: plan.extraBytes,
      amount: plan.amount,
      currency: plan.currency,
      paymentProvider: payment.provider,
      paymentRef: payment.reference,
      vendorNote: String(req.body?.note || "").slice(0, 500),
      status: payment.status === "PAID" ? "PAID" : "PENDING",
    });

    notifySuperadminsOfRecharge(recharge, vendor);

    res.status(201).json({
      success: true,
      message: `Recharge request for ${plan.name} submitted. It will be applied once a super admin verifies the payment.`,
      data: recharge,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/vendor/storage/recharges */
export const getMyStorageRecharges = async (req, res, next) => {
  try {
    const vendor = await getMyVendorOrThrow(req.user._id);
    const recharges = await StorageRecharge.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.status(200).json({ success: true, data: recharges });
  } catch (error) {
    next(error);
  }
};

// ─── Super admin ───────────────────────────────────────────────────────────

/** GET /api/admin/storage/vendors?search=&filter=all|near|full&page=&limit= */
export const listVendorStorage = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const search = String(req.query.search || "").trim();
    const filter = String(req.query.filter || "all");

    const match = {};
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      match.$or = [{ "businessDetails.businessName": rx }, { "brandDetails.brandName": rx }, { "sellerDetails.sellerName": rx }, { "sellerDetails.sellerEmail": rx }];
    }

    const base = [
      { $match: match },
      { $lookup: { from: VendorStorage.collection.name, localField: "_id", foreignField: "vendor", as: "storage" } },
      { $unwind: { path: "$storage", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          usedBytes: { $ifNull: ["$storage.usedBytes", 0] },
          quotaBytes: { $ifNull: ["$storage.quotaBytes", DEFAULT_VENDOR_QUOTA_BYTES] },
          assetCount: { $ifNull: ["$storage.assetCount", 0] },
        },
      },
      { $addFields: { percent: { $cond: [{ $gt: ["$quotaBytes", 0] }, { $multiply: [{ $divide: ["$usedBytes", "$quotaBytes"] }, 100] }, 100] } } },
    ];
    if (filter === "near") base.push({ $match: { percent: { $gte: 80 } } });
    if (filter === "full") base.push({ $match: { percent: { $gte: 100 } } });

    const [result] = await Vendor.aggregate([
      ...base,
      {
        $facet: {
          rows: [
            { $sort: { usedBytes: -1, _id: 1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                usedBytes: 1,
                quotaBytes: 1,
                assetCount: 1,
                percent: 1,
                status: 1,
                "businessDetails.businessName": 1,
                "brandDetails.brandName": 1,
                "brandDetails.brandLogo": 1,
                "sellerDetails.sellerName": 1,
                "sellerDetails.sellerEmail": 1,
                updatedAt: "$storage.updatedAt",
              },
            },
          ],
          total: [{ $count: "n" }],
        },
      },
    ]);

    // Platform-wide totals (unfiltered)
    const [totals] = await VendorStorage.aggregate([
      {
        $group: {
          _id: null,
          usedBytes: { $sum: "$usedBytes" },
          assets: { $sum: "$assetCount" },
          near: { $sum: { $cond: [{ $gte: [{ $divide: ["$usedBytes", "$quotaBytes"] }, 0.8] }, 1, 0] } },
          full: { $sum: { $cond: [{ $gte: ["$usedBytes", "$quotaBytes"] }, 1, 0] } },
        },
      },
    ]);
    const [vendorCount, pendingRecharges] = await Promise.all([Vendor.estimatedDocumentCount(), StorageRecharge.countDocuments({ status: { $in: ["PENDING", "PAID"] } })]);

    const total = result?.total?.[0]?.n || 0;
    res.status(200).json({
      success: true,
      data: {
        vendors: (result?.rows || []).map((v) => ({
          vendorId: v._id,
          name: vendorName(v),
          email: v.sellerDetails?.sellerEmail || "",
          logo: v.brandDetails?.brandLogo || "",
          status: v.status,
          usedBytes: v.usedBytes,
          quotaBytes: v.quotaBytes,
          assetCount: v.assetCount,
          percent: Math.round(v.percent * 10) / 10,
          updatedAt: v.updatedAt || null,
        })),
        totals: {
          vendors: vendorCount,
          usedBytes: totals?.usedBytes || 0,
          assets: totals?.assets || 0,
          nearLimit: totals?.near || 0,
          full: totals?.full || 0,
          pendingRecharges,
          defaultQuotaBytes: DEFAULT_VENDOR_QUOTA_BYTES,
        },
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/storage/vendors/:vendorId */
export const getVendorStorageDetail = async (req, res, next) => {
  try {
    const { vendorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(vendorId)) return next(new AppError("Invalid vendor id", 400));
    const vendor = await Vendor.findById(vendorId).select("businessDetails brandDetails sellerDetails status").lean();
    if (!vendor) return next(new AppError("Vendor not found", 404));

    const [usage, breakdown, largest, recent, recharges] = await Promise.all([
      getVendorUsage(vendor._id),
      breakdownFor(vendor._id),
      StorageAsset.find({ vendor: vendor._id, status: "active" }).sort({ bytes: -1 }).limit(20).select("url bytes kind createdAt").lean(),
      StorageAsset.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(20).select("url bytes kind status createdAt releasedAt").lean(),
      StorageRecharge.find({ vendor: vendor._id }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        vendor: { vendorId: vendor._id, name: vendorName(vendor), email: vendor.sellerDetails?.sellerEmail || "", logo: vendor.brandDetails?.brandLogo || "", status: vendor.status },
        usage: usagePayload(usage),
        breakdown,
        largest,
        recent,
        recharges,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/storage/vendors/:vendorId/quota  { quotaGb, reason? } */
export const setVendorQuota = async (req, res, next) => {
  try {
    const { vendorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(vendorId)) return next(new AppError("Invalid vendor id", 400));
    const quotaGb = Number(req.body?.quotaGb);
    if (!Number.isFinite(quotaGb) || quotaGb < 0.1 || quotaGb > 10000) return next(new AppError("Quota must be between 0.1 GB and 10000 GB.", 400));
    if (!String(req.body?.reason || "").trim()) return next(new AppError("Please give a reason for changing this vendor's storage limit.", 400));
    const vendorExists = await Vendor.exists({ _id: vendorId });
    if (!vendorExists) return next(new AppError("Vendor not found", 404));

    const usage = await ensureVendorUsage(vendorId);
    const before = usage.quotaBytes;
    const after = Math.round(quotaGb * GB);
    await VendorStorage.updateOne({ vendor: vendorId }, { $set: { quotaBytes: after } });
    await syncAlertLevel(vendorId);

    const reason = String(req.body?.reason || "").slice(0, 300);
    await audit(req, "UPDATE_VENDOR_STORAGE_QUOTA", vendorId, { quotaBytes: { from: before, to: after } }, reason || `Quota set to ${formatBytes(after)}`);
    await notifyVendor(vendorId, "Image storage limit updated", `Your image storage limit is now ${formatBytes(after)}.${reason ? ` Note: ${reason}` : ""}`, {
      kind: "STORAGE_QUOTA_UPDATED",
      quotaBytes: after,
    });

    res.status(200).json({ success: true, message: `Storage limit set to ${formatBytes(after)}.`, data: usagePayload({ ...usage.toObject(), quotaBytes: after }) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/storage/recharges?status=PENDING|APPROVED|REJECTED|ALL&page= */
export const listStorageRecharges = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = String(req.query.status || "PENDING").toUpperCase();
    const query = status === "ALL" ? {} : status === "PENDING" ? { status: { $in: ["PENDING", "PAID"] } } : { status };

    const [rows, total] = await Promise.all([
      StorageRecharge.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("vendor", "businessDetails.businessName brandDetails.brandName sellerDetails.sellerName sellerDetails.sellerEmail")
        .populate("reviewedBy", "name email")
        .lean(),
      StorageRecharge.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        recharges: rows.map((r) => ({ ...r, vendorName: vendorName(r.vendor) })),
        page,
        pages: Math.max(1, Math.ceil(total / limit)),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/storage/recharges/:id  { action: "APPROVE" | "REJECT", note? } */
export const reviewStorageRecharge = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(new AppError("Invalid recharge id", 400));
    const action = String(req.body?.action || "").toUpperCase();
    if (!["APPROVE", "REJECT"].includes(action)) return next(new AppError('Action must be "APPROVE" or "REJECT".', 400));
    const note = String(req.body?.note || "").slice(0, 500);
    if (action === "REJECT" && !note.trim()) return next(new AppError("Please give a reason for rejecting this recharge.", 400));
    // No payment gateway yet: approving adds paid storage, so the admin must explicitly confirm the money was received
    if (action === "APPROVE" && req.body?.paymentVerified !== true) {
      return next(new AppError("Confirm that you have verified the payment was received before approving this recharge.", 400));
    }

    // Atomic claim so a recharge can only be reviewed once
    const recharge = await StorageRecharge.findOneAndUpdate(
      { _id: id, status: { $in: ["PENDING", "PAID"] } },
      { $set: { status: action === "APPROVE" ? "APPROVED" : "REJECTED", reviewedBy: req.user._id, reviewedAt: new Date(), adminNote: note } },
      { returnDocument: "after" }
    );
    if (!recharge) return next(new AppError("This recharge was not found or has already been reviewed.", 409));

    if (action === "APPROVE") {
      const usage = await ensureVendorUsage(recharge.vendor);
      const before = usage.quotaBytes;
      const updated = await VendorStorage.findOneAndUpdate({ vendor: recharge.vendor }, { $inc: { quotaBytes: recharge.extraBytes } }, { returnDocument: "after" });
      await StorageRecharge.updateOne({ _id: recharge._id }, { $set: { quotaBefore: before, quotaAfter: updated.quotaBytes } });
      await syncAlertLevel(recharge.vendor);
      await audit(req, "APPROVE_STORAGE_RECHARGE", recharge.vendor, { quotaBytes: { from: before, to: updated.quotaBytes }, rechargeId: recharge._id }, `${recharge.planName} (${recharge.currency} ${recharge.amount})`);
      await notifyVendor(
        recharge.vendor,
        "Storage recharge approved",
        `${recharge.planName} was added. Your image storage limit is now ${formatBytes(updated.quotaBytes)}.`,
        { kind: "STORAGE_RECHARGE", status: "APPROVED", rechargeId: recharge._id, quotaBytes: updated.quotaBytes }
      );
      return res.status(200).json({ success: true, message: `Recharge approved. New limit: ${formatBytes(updated.quotaBytes)}.`, data: { ...recharge.toObject(), quotaBefore: before, quotaAfter: updated.quotaBytes } });
    }

    await audit(req, "REJECT_STORAGE_RECHARGE", recharge.vendor, { rechargeId: recharge._id }, note);
    await notifyVendor(recharge.vendor, "Storage recharge rejected", `Your ${recharge.planName} request was rejected. Reason: ${note}`, {
      kind: "STORAGE_RECHARGE",
      status: "REJECTED",
      rechargeId: recharge._id,
    });
    res.status(200).json({ success: true, message: "Recharge rejected.", data: recharge });
  } catch (error) {
    next(error);
  }
};

import { AsyncLocalStorage } from "node:async_hooks";
import VendorStorage from "../models/VendorStorage.js";
import StorageAsset from "../models/StorageAsset.js";
import Vendor from "../models/Vendor.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Refund from "../models/Refund.js";
import Cart from "../models/Cart.js";
import Wishlist from "../models/Wishlist.js";
import Brand from "../models/Brand.js";
import VendorNotification from "../models/VendorNotification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { emitVendorNotification } from "../socket/socketManager.js";
import { sendEmail } from "./sendEmail.js";
import { getStorageProvider, activeStorageProviderName } from "./storage/index.js";
import { DEFAULT_VENDOR_QUOTA_BYTES, STORAGE_ALERT_LEVELS, GB } from "../config/storagePlans.js";

/**
 * Vendor image-storage quota service.
 *
 * Safety rules:
 *   • Only NEW collections are written (VendorStorage, StorageAsset) + normal SYSTEM vendor notifications.
 *   • Only images uploaded after this feature went live are counted (old images are ignored).
 *   • Apart from the quota check itself, nothing here may break an upload or a product save —
 *     tracking / release / alert failures are logged and swallowed.
 *   • A released file is only deleted from storage if nothing else (orders, refunds, carts, wishlists,
 *     other products, vendor logo/QR, brands) still references its URL — so order history never breaks.
 */

// ─── Request context (which vendor / image kind an upload belongs to) ──────
const storageContext = new AsyncLocalStorage();
export const getStorageContext = () => storageContext.getStore() || null;
export const runWithStorageContext = (ctx, fn) => storageContext.run(ctx, fn);

export const formatBytes = (bytes = 0) => {
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

/** Usage document for a vendor, or a virtual default (nothing is written). */
export async function getVendorUsage(vendorId) {
  const doc = await VendorStorage.findOne({ vendor: vendorId }).lean();
  return doc || { vendor: vendorId, usedBytes: 0, quotaBytes: DEFAULT_VENDOR_QUOTA_BYTES, assetCount: 0, lastAlertLevel: 0, isVirtual: true };
}

/** Create the usage document on first use (upsert into the NEW collection only). */
export async function ensureVendorUsage(vendorId) {
  return VendorStorage.findOneAndUpdate(
    { vendor: vendorId },
    { $setOnInsert: { vendor: vendorId, usedBytes: 0, quotaBytes: DEFAULT_VENDOR_QUOTA_BYTES, assetCount: 0, lastAlertLevel: 0 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}

const storageFullError = (usage, incomingBytes = 0) => {
  const left = Math.max(0, usage.quotaBytes - usage.usedBytes);
  const msg =
    left <= 0
      ? `Your image storage is full (${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used). Recharge storage to upload more images.`
      : `Not enough image storage: this upload needs ${formatBytes(incomingBytes)} but only ${formatBytes(left)} is left of ${formatBytes(usage.quotaBytes)}. Recharge storage to upload more images.`;
  const err = new AppError(msg, 413);
  err.code = "STORAGE_QUOTA_EXCEEDED";
  return err;
};

/** True when the vendor has no space left at all (used by the route middleware before parsing work). */
export async function isStorageFull(vendorId) {
  const usage = await getVendorUsage(vendorId);
  return usage.usedBytes >= usage.quotaBytes ? usage : null;
}

/** Throws a 413 AppError when `incomingBytes` would push the vendor over quota. */
export async function assertCanUpload(vendorId, incomingBytes = 0) {
  const usage = await getVendorUsage(vendorId);
  if (usage.usedBytes >= usage.quotaBytes || usage.usedBytes + incomingBytes > usage.quotaBytes) {
    throw storageFullError(usage, incomingBytes);
  }
}

/** Estimate the stored size of what is about to be uploaded (Buffer or base64 data URI). */
export const estimateUploadBytes = (fileSource) => {
  if (Buffer.isBuffer(fileSource)) return fileSource.length;
  if (typeof fileSource === "string") {
    const m = fileSource.match(/^data:[^;]+;base64,(.*)$/);
    if (m) return Math.floor((m[1].length * 3) / 4);
  }
  return 0; // remote URL etc. — size unknown until Cloudinary returns it
};

/**
 * Record a stored image for the vendor in the current context. Never throws.
 * @param {{ vendorId: any, kind: string }} ctx
 * @param {{ key: string, url: string, bytes: number }} asset
 */
export async function trackUpload(ctx, { key, url, bytes }) {
  try {
    if (!ctx?.vendorId || !key || !url) return;
    const size = Number(bytes) || 0;
    await ensureVendorUsage(ctx.vendorId);
    await StorageAsset.create({
      vendor: ctx.vendorId,
      provider: activeStorageProviderName(),
      key,
      url,
      bytes: size,
      kind: ["product", "logo", "qr", "brand"].includes(ctx.kind) ? ctx.kind : "other",
    });
    await VendorStorage.updateOne({ vendor: ctx.vendorId }, { $inc: { usedBytes: size, assetCount: 1 } });
    if (Array.isArray(ctx.uploadedUrls)) ctx.uploadedUrls.push(url); // lets the middleware roll back on a failed request
    checkStorageAlerts(ctx.vendorId).catch(() => {});
  } catch (error) {
    console.warn("[StorageQuota] Failed to track upload:", error.message);
  }
}

/** Is this URL still used anywhere (so the file must be kept)? Read-only queries. */
async function isUrlStillReferenced(url) {
  const checks = [
    Product.exists({ "images.url": url, isDeleted: { $ne: true } }),
    Order.exists({ "items.imageUrl": url }),
    Refund.exists({ "items.imageUrl": url }),
    Cart.exists({ "items.imageUrl": url }),
    Wishlist.exists({ $or: [{ "items.imageUrl": url }, { "items.image": url }] }),
    Vendor.exists({ $or: [{ "brandDetails.brandLogo": url }, { "paymentSettings.qrCodeUrl": url }] }),
    Brand.exists({ "logo.url": url }),
  ];
  const results = await Promise.all(checks.map((p) => p.catch(() => true))); // on error, assume referenced (keep the file)
  return results.some(Boolean);
}

/**
 * Release tracked images (photo removed, product deleted, logo/QR replaced). Never throws.
 * Usage is always decreased; the file itself is deleted only if nothing references it anymore.
 * Untracked (pre-feature) URLs are simply ignored.
 */
export async function releaseByUrls(vendorId, urls = []) {
  try {
    const list = [...new Set((urls || []).filter((u) => typeof u === "string" && u.trim()))];
    if (!vendorId || list.length === 0) return;
    const assets = await StorageAsset.find({ vendor: vendorId, url: { $in: list }, status: "active" });
    for (const asset of assets) {
      // Atomic flip so a double release can't subtract twice
      const flipped = await StorageAsset.findOneAndUpdate(
        { _id: asset._id, status: "active" },
        { $set: { status: "released", releasedAt: new Date() } },
        { returnDocument: "after" }
      );
      if (!flipped) continue;
      await VendorStorage.updateOne({ vendor: vendorId }, { $inc: { usedBytes: -asset.bytes, assetCount: -1 } });
      await VendorStorage.updateOne({ vendor: vendorId, usedBytes: { $lt: 0 } }, { $set: { usedBytes: 0 } });
      await VendorStorage.updateOne({ vendor: vendorId, assetCount: { $lt: 0 } }, { $set: { assetCount: 0 } });

      if (!(await isUrlStillReferenced(asset.url))) {
        try {
          const removed = await getStorageProvider(asset.provider).remove(asset.key);
          if (removed) await StorageAsset.updateOne({ _id: asset._id }, { $set: { fileDeleted: true } });
        } catch (error) {
          console.warn("[StorageQuota] File delete failed (usage already released):", error.message);
        }
      }
    }
    await syncAlertLevel(vendorId);
  } catch (error) {
    console.warn("[StorageQuota] Failed to release images:", error.message);
  }
}

const levelFor = (usedBytes, quotaBytes) => {
  const pct = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 100;
  return STORAGE_ALERT_LEVELS.filter((l) => pct >= l).pop() || 0;
};

/** After usage drops or quota grows, lower the remembered alert level so future crossings alert again. */
export async function syncAlertLevel(vendorId) {
  try {
    const usage = await VendorStorage.findOne({ vendor: vendorId });
    if (!usage) return;
    const level = levelFor(usage.usedBytes, usage.quotaBytes);
    if (level < usage.lastAlertLevel) {
      await VendorStorage.updateOne({ _id: usage._id }, { $set: { lastAlertLevel: level } });
    }
  } catch (error) {
    console.warn("[StorageQuota] Failed to sync alert level:", error.message);
  }
}

/** Send the 80% / 90% / 100% alert once per level (in-app notification + socket + email). Never throws. */
export async function checkStorageAlerts(vendorId) {
  try {
    const usage = await VendorStorage.findOne({ vendor: vendorId }).lean();
    if (!usage) return;
    const level = levelFor(usage.usedBytes, usage.quotaBytes);
    if (level <= (usage.lastAlertLevel || 0)) return;

    // Claim this level atomically so concurrent uploads send it only once
    const claimed = await VendorStorage.findOneAndUpdate(
      { vendor: vendorId, lastAlertLevel: { $lt: level } },
      { $set: { lastAlertLevel: level, lastAlertAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!claimed) return;

    const used = formatBytes(usage.usedBytes);
    const quota = formatBytes(usage.quotaBytes);
    const full = level >= 100;
    const title = full ? "Image storage full" : `Image storage ${level}% used`;
    const message = full
      ? `You've used ${used} of your ${quota} image storage. New image uploads are blocked until you recharge storage.`
      : `You've used ${used} of your ${quota} image storage (${level}%). Recharge storage soon to keep uploading product photos.`;

    const notif = await VendorNotification.create({
      vendor: vendorId,
      type: "SYSTEM",
      title,
      message,
      data: { kind: "STORAGE_ALERT", level, usedBytes: usage.usedBytes, quotaBytes: usage.quotaBytes },
    });
    try {
      emitVendorNotification(vendorId, notif);
    } catch {
      /* socket optional */
    }

    // Email (best effort)
    const vendor = await Vendor.findById(vendorId).select("userId sellerDetails businessDetails").lean();
    let email = vendor?.sellerDetails?.sellerEmail || vendor?.businessDetails?.businessEmail;
    if (!email && vendor?.userId) email = (await User.findById(vendor.userId).select("email").lean())?.email;
    if (email) {
      sendEmail({
        to: email,
        subject: `BhansaMart: ${title}`,
        text: `${message}\n\nOpen your Seller Hub → Storage to recharge.`,
        html: `<p>${message}</p><p>Open your <b>Seller Hub → Storage</b> to recharge.</p>`,
      }).catch((e) => console.warn("[StorageQuota] Alert email failed:", e.message));
    }
  } catch (error) {
    console.warn("[StorageQuota] Failed to send storage alert:", error.message);
  }
}

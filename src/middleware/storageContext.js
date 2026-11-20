import Vendor from "../models/Vendor.js";
import { isStorageFull, runWithStorageContext, releaseByUrls, formatBytes } from "../utils/storageQuota.js";
import { AppError } from "./errorMiddleware.js";

/**
 * Marks a vendor upload request so the upload helpers (utils/cloudinaryUpload.js) can enforce the
 * vendor's storage quota and record each stored image — without changing the controllers' upload code.
 *
 * Place it AFTER multer on a route, e.g. `upload.array("images", 10), storageContext("product"), createProduct`.
 * Non-vendor users (admins) pass straight through untracked. If the lookup fails, the request continues
 * untracked rather than being blocked.
 *
 * @param {"product"|"logo"|"qr"|"brand"} kind
 */
export const storageContext = (kind) => async (req, res, next) => {
  let vendorId = null;
  try {
    if (req.user?.role === "vendor") {
      const vendor = await Vendor.findOne({ userId: req.user._id }).select("_id").lean();
      vendorId = vendor?._id || null;
    }
  } catch (error) {
    console.warn("[StorageContext] Vendor lookup failed, continuing untracked:", error.message);
    vendorId = null;
  }

  if (!vendorId) return next();

  // Reject early if the vendor is already at/over quota AND this request carries new images
  try {
    const hasFiles =
      Boolean(req.file) ||
      (Array.isArray(req.files) && req.files.length > 0) ||
      (req.files && !Array.isArray(req.files) && Object.keys(req.files).length > 0) ||
      (typeof req.body?.images === "string" && req.body.images.includes("data:image")) ||
      (Array.isArray(req.body?.images) && req.body.images.some((i) => String(i?.base64 || i?.uri || i).startsWith("data:image")));
    if (hasFiles) {
      const full = await isStorageFull(vendorId);
      if (full) {
        const err = new AppError(
          `Your image storage is full (${formatBytes(full.usedBytes)} of ${formatBytes(full.quotaBytes)} used). Recharge storage to upload more images.`,
          413
        );
        err.code = "STORAGE_QUOTA_EXCEEDED";
        return next(err);
      }
    }
  } catch (error) {
    console.warn("[StorageContext] Quota pre-check failed, continuing:", error.message);
  }

  const ctx = { vendorId, kind, uploadedUrls: [] };

  // If the request fails after some images were already stored (e.g. the 3rd photo of a product hits the
  // quota, or the product fails validation), release what this request stored so nothing is left counted
  // against the vendor for an item that was never saved.
  res.on("finish", () => {
    if (res.statusCode >= 400 && ctx.uploadedUrls.length) {
      releaseByUrls(vendorId, ctx.uploadedUrls).catch(() => {});
    }
  });

  return runWithStorageContext(ctx, () => next());
};

export default storageContext;

import cloudinary from "../../config/cloudinary.js";

/**
 * Storage provider layer for the vendor storage feature.
 *
 * Today images are uploaded to Cloudinary by utils/cloudinaryUpload.js (unchanged). The quota system only
 * needs two things from a provider — its name and a way to delete a stored file by key — so moving to
 * our own server later means adding a provider here (e.g. LocalDiskProvider) and switching
 * STORAGE_PROVIDER in .env. Usage accounting (bytes + key per asset) stays the same.
 */

const cloudinaryProvider = {
  name: "cloudinary",
  /** Delete by Cloudinary public_id (the full path, e.g. "bhansamart/vendor/logos/abc123") */
  async remove(key) {
    if (!key) return false;
    const res = await cloudinary.uploader.destroy(key, { invalidate: true });
    return res?.result === "ok" || res?.result === "not found";
  },
};

// Future: local disk / S3 providers go here, e.g.
// const localProvider = { name: "local", async remove(key) { await fs.promises.unlink(path.join(UPLOAD_DIR, key)); return true; } };

const PROVIDERS = { cloudinary: cloudinaryProvider };

export const getStorageProvider = (name) => PROVIDERS[name || process.env.STORAGE_PROVIDER || "cloudinary"] || cloudinaryProvider;

export const activeStorageProviderName = () => getStorageProvider().name;

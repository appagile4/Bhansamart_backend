import cloudinary from "../config/cloudinary.js";

/**
 * Sanitize folder and slug path to be Cloudinary-safe (only a-z, 0-9, _, -)
 */
const sanitizePath = (pathStr) => {
  return String(pathStr || "")
    .split("/")
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
    )
    .filter(Boolean)
    .join("/");
};

/**
 * Upload an image buffer or base64 string to Cloudinary
 * @param {Buffer|string} fileSource - Buffer from multer or base64 string
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<Object>} Cloudinary upload result
 */
export const uploadToCloudinary = (fileSource, folder = "bhansamart/avatars") => {
  return new Promise((resolve, reject) => {
    const safeFolder = sanitizePath(folder) || "bhansamart/avatars";

    // If base64 string or URI
    if (typeof fileSource === "string") {
      cloudinary.uploader.upload(
        fileSource,
        {
          folder: safeFolder,
          transformation: [
            { width: 500, height: 500, crop: "fill", gravity: "face" },
            { quality: "auto" },
            { fetch_format: "auto" },
          ],
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      return;
    }

    // If buffer
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: safeFolder,
        transformation: [
          { width: 500, height: 500, crop: "fill", gravity: "face" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    uploadStream.end(fileSource);
  });
};

/**
 * Upload product image to Cloudinary (optimized for ecommerce products)
 * @param {Buffer|string} fileSource 
 * @param {string} vendorSlug 
 * @returns {Promise<{url: string, publicId: string}>}
 */
export const uploadProductImageToCloudinary = (
  fileSource,
  vendorSlug = "general"
) => {
  return new Promise((resolve, reject) => {
    const safeVendorSlug = sanitizePath(vendorSlug) || "general";
    const folder = `bhansamart/vendors/${safeVendorSlug}/products`;
    const options = {
      folder,
      transformation: [
        { width: 1200, height: 1200, crop: "limit" },
        { quality: "auto" },
        { fetch_format: "auto" },
      ],
    };

    if (typeof fileSource === "string") {
      cloudinary.uploader.upload(fileSource, options, (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url || result.url,
          publicId: result.public_id,
        });
      });
      return;
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url || result.url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(fileSource);
  });
};

/**
 * Delete an image from Cloudinary using its public URL or public_id
 * @param {string} imageUrl - Cloudinary secure URL or public_id
 */
export const deleteFromCloudinary = async (imageUrl) => {
  try {
    if (!imageUrl || !imageUrl.includes("cloudinary.com")) return;
    
    // Extract public_id from URL: e.g. .../bhansamart/avatars/abc123.jpg
    const parts = imageUrl.split("/");
    const filenameWithExt = parts.slice(-2).join("/").split(".")[0];
    if (filenameWithExt) {
      await cloudinary.uploader.destroy(filenameWithExt);
    }
  } catch (error) {
    console.warn("[Cloudinary] Failed to delete previous image:", error.message);
  }
};

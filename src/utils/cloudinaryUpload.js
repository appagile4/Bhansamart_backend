import cloudinary from "../config/cloudinary.js";

/**
 * Upload an image buffer or base64 string to Cloudinary
 * @param {Buffer|string} fileSource - Buffer from multer or base64 string
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<Object>} Cloudinary upload result
 */
export const uploadToCloudinary = (fileSource, folder = "bhansamart/avatars") => {
  return new Promise((resolve, reject) => {
    // If base64 string or URI
    if (typeof fileSource === "string") {
      cloudinary.uploader.upload(
        fileSource,
        {
          folder,
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
        folder,
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

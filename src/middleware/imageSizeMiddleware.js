import sharp from "sharp";
import { AppError } from "./errorMiddleware.js";
import { dataUriToBuffer } from "../utils/imageCompressor.js";

/**
 * Minimum image size (pixels) per upload type. Compared on shorter/longer side, so portrait and
 * landscape photos follow the same rule.
 * Keep in sync with: Bhansamart_Website/src/lib/imageUpload.ts and Bhansamart_frontend/src/utils/imageSize.ts
 */
export const MIN_IMAGE_SIZE = {
  product: { shorter: 600, longer: 1000, label: "Product photo" },
  category: { shorter: 400, longer: 600, label: "Category image" },
  document: { shorter: 600, longer: 1000, label: "Document photo" },
  qr: { shorter: 400, longer: 400, label: "Payment QR image" },
  logo: { shorter: 300, longer: 300, label: "Logo" },
  avatar: { shorter: 300, longer: 300, label: "Profile photo" },
};

/** Returns an error message when the image is too small, otherwise null. */
export async function imageSizeError(buffer, kind) {
  const min = MIN_IMAGE_SIZE[kind];
  if (!min || !Buffer.isBuffer(buffer) || !buffer.length) return null;

  let meta;
  try {
    meta = await sharp(buffer, { failOn: "none" }).metadata();
  } catch (error) {
    // Formats sharp can't read (e.g. some HEIC files) can't be measured: let them through as before
    console.warn(`[ImageSize] Could not read ${kind} image: ${error.message}`);
    return null;
  }
  if (!meta.width || !meta.height || meta.format === "svg") return null;

  const shorter = Math.min(meta.width, meta.height);
  const longer = Math.max(meta.width, meta.height);
  if (shorter >= min.shorter && longer >= min.longer) return null;

  return `${min.label} is too small (${meta.width}×${meta.height} px). Please upload at least ${min.longer}×${min.shorter} px.`;
}

const uploadedBuffers = (req) => {
  const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
  return files.map((f) => f?.buffer).filter(Boolean);
};

const bodyBuffers = (body, fields) =>
  fields.flatMap((field) => {
    let value = body?.[field];
    if (typeof value === "string" && value.trim().startsWith("[")) {
      try {
        value = JSON.parse(value);
      } catch {
        return [];
      }
    }
    return (Array.isArray(value) ? value : [value])
      .map((v) => dataUriToBuffer(v && typeof v === "object" ? v.uri || v.url || v.base64 : v))
      .filter(Boolean);
  });

/**
 * Rejects the request (400) when any uploaded image is below the minimum size. Place it right AFTER
 * multer, so nothing has been uploaded, deleted or saved yet when an image is rejected.
 *
 * @param {keyof MIN_IMAGE_SIZE} kind
 * @param {string[]} [bodyFields] body fields that may carry base64 data URIs for this route
 */
export const requireMinImageSize = (kind, bodyFields = []) => async (req, res, next) => {
  try {
    for (const buffer of [...uploadedBuffers(req), ...bodyBuffers(req.body, bodyFields)]) {
      const message = await imageSizeError(buffer, kind);
      if (message) return next(new AppError(message, 400));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

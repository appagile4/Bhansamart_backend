import sharp from "sharp";

/**
 * Image compressor — runs on the server BEFORE an image is sent to cloud storage
 * (Cloudinary today, S3 or anything else later). It is storage-agnostic: give it a buffer,
 * get back a (usually much smaller) buffer.
 *
 * Safety rules, so existing upload flows never break:
 *   • Any failure (unsupported format such as HEIC, corrupt file, …) → the ORIGINAL buffer is returned.
 *   • If the compressed result isn't smaller than the original → the ORIGINAL buffer is returned.
 *   • Animated images (GIF/animated WebP) and SVGs are passed through untouched.
 *   • IMAGE_COMPRESSION=off in .env disables it completely.
 *
 * Quality approach: only downscale images larger than the preset's max size (never upscale),
 * re-encode to WebP at a visually-lossless quality, and use LOSSLESS for QR codes so they stay
 * scannable. Pixels are NEVER rotated: if a phone photo carries an orientation tag, only that tag is kept
 * so it displays exactly as the user saw it; all other metadata (GPS, camera info) is stripped.
 */

export const COMPRESSION_PRESETS = {
  // Product photos: sharp enough to zoom, typically 3–5 MB → 150–400 KB
  product: { maxWidth: 1600, maxHeight: 1600, quality: 82 },
  // Category banners & icons
  category: { maxWidth: 1200, maxHeight: 1200, quality: 82 },
  // Store / brand logos: crisp edges, transparency preserved
  logo: { maxWidth: 1000, maxHeight: 1000, quality: 90, alphaQuality: 100 },
  // Payment QR codes: lossless so every module stays sharp and scannable
  qr: { maxWidth: 1400, maxHeight: 1400, lossless: true },
  // ID / KYC documents: text must stay legible
  document: { maxWidth: 2000, maxHeight: 2000, quality: 90 },
  // Profile photos
  avatar: { maxWidth: 800, maxHeight: 800, quality: 82 },
  // Anything else
  default: { maxWidth: 1600, maxHeight: 1600, quality: 82 },
};

const MAX_INPUT_PIXELS = 60_000_000; // ~60 MP — guards against decompression bombs

const isEnabled = () => String(process.env.IMAGE_COMPRESSION || "on").toLowerCase() !== "off";

/** Pick a preset from the Cloudinary folder an image is going to (keeps call sites unchanged). */
export const presetForFolder = (folder = "") => {
  const f = String(folder).toLowerCase();
  if (f.includes("payment-qr") || f.includes("payment_qr") || f.includes("qr")) return "qr";
  if (f.includes("document")) return "document";
  if (f.includes("logo") || f.includes("brands")) return "logo";
  if (f.includes("avatar") || f.includes("profile")) return "avatar";
  if (f.includes("categor")) return "category";
  if (f.includes("product")) return "product";
  return "default";
};

/** Turn a `data:image/...;base64,...` string into a Buffer; anything else (http URLs, file: URIs) → null. */
export const dataUriToBuffer = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
};

/**
 * Compress an image buffer.
 * @param {Buffer} input
 * @param {keyof COMPRESSION_PRESETS} [presetName="default"]
 * @returns {Promise<{ buffer: Buffer, compressed: boolean, contentType?: string, format?: string,
 *                     width?: number, height?: number, originalBytes: number, outputBytes: number, reason?: string }>}
 */
export async function compressImage(input, presetName = "default") {
  const originalBytes = Buffer.isBuffer(input) ? input.length : 0;
  const passthrough = (reason) => ({ buffer: input, compressed: false, originalBytes, outputBytes: originalBytes, reason });

  if (!Buffer.isBuffer(input) || !input.length) return passthrough("not a buffer");
  if (!isEnabled()) return passthrough("disabled");

  const preset = COMPRESSION_PRESETS[presetName] || COMPRESSION_PRESETS.default;

  try {
    // animated: true so `pages` reports every frame (otherwise a GIF looks like a single still image)
    const meta = await sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS, animated: true }).metadata();

    if (!meta.format) return passthrough("unknown format");
    if (meta.format === "svg") return passthrough("svg");
    if ((meta.pages || 1) > 1) return passthrough("animated");

    let pipeline = sharp(input, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS })
      .resize({
        width: preset.maxWidth,
        height: preset.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });

    const webpOptions = preset.lossless
      ? { lossless: true, effort: 4 }
      : {
          quality: preset.quality,
          alphaQuality: preset.alphaQuality ?? 100,
          smartSubsample: true,
          effort: 4,
        };

    // Orientation tag present: keep it (and nothing else) instead of rotating the pixels.
    // JPEG is used for these because its orientation tag is the most widely supported.
    const hasOrientationTag = (meta.orientation || 1) > 1;
    if (hasOrientationTag) pipeline = pipeline.withExif({ IFD0: { Orientation: String(meta.orientation) } });
    const asJpeg = hasOrientationTag && !meta.hasAlpha;
    pipeline = asJpeg
      ? pipeline.jpeg({
          quality: preset.lossless ? 95 : preset.quality,
          chromaSubsampling: preset.lossless ? "4:4:4" : "4:2:0",
          mozjpeg: true,
        })
      : pipeline.webp(webpOptions);

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    // Never make an image bigger (e.g. already-optimised files)
    if (data.length >= originalBytes) return passthrough("not smaller");

    return {
      buffer: data,
      compressed: true,
      contentType: asJpeg ? "image/jpeg" : "image/webp",
      format: asJpeg ? "jpeg" : "webp",
      width: info.width,
      height: info.height,
      originalBytes,
      outputBytes: data.length,
    };
  } catch (error) {
    // e.g. HEIC (not supported by sharp's prebuilt binaries) — upload the original instead
    console.warn(`[ImageCompressor] Skipped (${presetName}): ${error.message}`);
    return passthrough("error");
  }
}

/**
 * Convenience wrapper used by the upload helpers: accepts a Buffer or a base64 data URI,
 * returns what should be uploaded (Buffer when compression is possible, otherwise the original value).
 */
export async function compressForUpload(fileSource, presetName = "default") {
  const buffer = Buffer.isBuffer(fileSource) ? fileSource : dataUriToBuffer(fileSource);
  if (!buffer) return fileSource; // http(s) / file: URIs etc. — leave exactly as before

  const result = await compressImage(buffer, presetName);
  if (result.compressed) {
    const pct = Math.round((1 - result.outputBytes / result.originalBytes) * 100);
    console.log(
      `[ImageCompressor] ${presetName}: ${(result.originalBytes / 1024).toFixed(0)} KB → ${(result.outputBytes / 1024).toFixed(0)} KB (-${pct}%) ${result.width}x${result.height}`
    );
    return result.buffer;
  }
  // Not compressed: keep the caller's original value (Buffer or data URI string) untouched
  return fileSource;
}

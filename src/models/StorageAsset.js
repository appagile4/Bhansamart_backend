import mongoose from "mongoose";

/**
 * One record per vendor image stored after the storage feature went live (NEW collection: "storageassets").
 * Provider-agnostic so images can later move from Cloudinary to our own server (provider + key).
 * Released assets are kept (status "released") as an audit trail.
 */
const storageAssetSchema = new mongoose.Schema(
  {
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true },
    provider: { type: String, default: "cloudinary" }, // cloudinary | local | s3 …
    key: { type: String, required: true }, // Cloudinary public_id, or file path / object key for other providers
    url: { type: String, required: true },
    bytes: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: ["product", "logo", "qr", "brand", "other"], default: "other" },
    status: { type: String, enum: ["active", "released"], default: "active" },
    releasedAt: { type: Date, default: null },
    // Whether the underlying file was actually deleted when released (kept if still used by orders etc.)
    fileDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

storageAssetSchema.index({ vendor: 1, status: 1, createdAt: -1 });
storageAssetSchema.index({ url: 1 });

const StorageAsset = mongoose.model("StorageAsset", storageAssetSchema);
export default StorageAsset;

import mongoose from "mongoose";

/**
 * Per-vendor image storage usage & quota (NEW collection: "vendorstorages").
 * Created lazily on a vendor's first tracked upload — existing collections are not touched.
 * Only images uploaded after the storage feature went live are counted.
 */
const vendorStorageSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      unique: true,
    },
    usedBytes: { type: Number, default: 0, min: 0 },
    quotaBytes: { type: Number, required: true },
    assetCount: { type: Number, default: 0, min: 0 },
    // Highest alert level already sent (0, 80, 90, 100) — each level is sent once until usage drops / quota grows
    lastAlertLevel: { type: Number, default: 0 },
    lastAlertAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vendorStorageSchema.index({ usedBytes: -1 });

const VendorStorage = mongoose.model("VendorStorage", vendorStorageSchema);
export default VendorStorage;

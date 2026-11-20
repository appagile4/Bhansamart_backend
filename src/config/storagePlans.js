/**
 * Vendor image-storage settings & recharge plans.
 * Default quota can be overridden with VENDOR_STORAGE_QUOTA_GB in .env.
 * Plan prices are placeholders until a real payment gateway is added — edit freely.
 */
export const GB = 1024 * 1024 * 1024;

export const DEFAULT_VENDOR_QUOTA_BYTES = Math.round((Number(process.env.VENDOR_STORAGE_QUOTA_GB) || 5) * GB);

// Alert thresholds (percent of quota)
export const STORAGE_ALERT_LEVELS = [80, 90, 100];

export const STORAGE_PLANS = [
  { id: "plus-5gb", name: "+5 GB Storage", extraBytes: 5 * GB, amount: 500, currency: "NPR" },
  { id: "plus-10gb", name: "+10 GB Storage", extraBytes: 10 * GB, amount: 900, currency: "NPR" },
  { id: "plus-25gb", name: "+25 GB Storage", extraBytes: 25 * GB, amount: 2000, currency: "NPR" },
];

export const findStoragePlan = (id) => STORAGE_PLANS.find((p) => p.id === id) || null;

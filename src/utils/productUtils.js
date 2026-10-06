import Product from "../models/Product.js";

/**
 * Slugify a string into a URL-friendly slug
 */
export const slugify = (text) => {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * Generate a unique slug in the database
 */
export const generateUniqueSlug = async (name, excludeProductId = null) => {
  const baseSlug = slugify(name) || `product-${Date.now()}`;
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const query = { slug, isDeleted: false };
    if (excludeProductId) {
      query._id = { $ne: excludeProductId };
    }
    const existing = await Product.findOne(query);
    if (!existing) break;
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
};

/**
 * Generate unique SKU (e.g., BM-GRO-98432)
 */
export const generateSku = (category = "BM") => {
  const prefix = (category.slice(0, 3) || "PRD").toUpperCase().replace(/[^A-Z]/g, "X");
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `BM-${prefix}-${randomNum}`;
};

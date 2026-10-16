import Attribute from "../models/Attribute.js";
import Vendor from "../models/Vendor.js";

const slugifyAttribute = (name) => {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * @desc    Get active attributes (optionally filtered by category)
 * @route   GET /api/attributes
 * @access  Public / Authenticated
 */
export const getAttributes = async (req, res) => {
  try {
    const { category, search } = req.query;

    const query = { status: "ACTIVE" };

    if (category && category !== "all" && category !== "All" && category !== "All Categories") {
      let cleanCat = String(category).trim();
      try {
        cleanCat = decodeURIComponent(cleanCat).trim();
      } catch {}
      const escapedCat = cleanCat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { categories: { $regex: escapedCat, $options: "i" } },
        { categories: { $size: 0 } },
        { categories: { $exists: false } },
      ];
    }

    if (search && String(search).trim().length > 0) {
      query.name = { $regex: String(search).trim(), $options: "i" };
    }

    const attributes = await Attribute.find(query).sort({ isGlobal: -1, name: 1 }).lean();

    return res.status(200).json({
      success: true,
      count: attributes.length,
      attributes,
      data: attributes,
    });
  } catch (error) {
    console.error("Error in getAttributes:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attributes",
      error: error.message,
    });
  }
};

/**
 * @desc    Create or add values to an attribute from Vendor Panel
 * @route   POST /api/vendor/attributes or POST /api/attributes
 * @access  Private (Vendor / Admin)
 */
export const createAttribute = async (req, res) => {
  try {
    const { name, categories, values, type = "single", description = "" } = req.body;

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Attribute name is required",
      });
    }

    const trimmedName = String(name).trim();
    const slug = slugifyAttribute(trimmedName);

    // Resolve Vendor
    let vendor = await Vendor.findOne({ userId: req.user._id || req.user.id });

    // Parse categories
    let parsedCategories = [];
    if (categories) {
      if (Array.isArray(categories)) {
        parsedCategories = categories.map((c) => String(c).trim()).filter(Boolean);
      } else if (typeof categories === "string") {
        try {
          const parsed = JSON.parse(categories);
          parsedCategories = Array.isArray(parsed)
            ? parsed.map((c) => String(c).trim()).filter(Boolean)
            : [categories.trim()];
        } catch {
          parsedCategories = categories.split(",").map((c) => c.trim()).filter(Boolean);
        }
      }
    }

    // Parse values
    let parsedValues = [];
    if (values) {
      if (Array.isArray(values)) {
        parsedValues = values.map((v) => String(v).trim()).filter(Boolean);
      } else if (typeof values === "string") {
        try {
          const parsed = JSON.parse(values);
          parsedValues = Array.isArray(parsed)
            ? parsed.map((v) => String(v).trim()).filter(Boolean)
            : [values.trim()];
        } catch {
          parsedValues = values.split(",").map((v) => v.trim()).filter(Boolean);
        }
      }
    }

    // Check if attribute already exists
    let attribute = await Attribute.findOne({
      $or: [
        { slug },
        { name: { $regex: `^${trimmedName}$`, $options: "i" } },
      ],
    });

    if (attribute) {
      // Merge values
      const mergedValues = Array.from(
        new Set([...(attribute.values || []), ...parsedValues])
      );
      const mergedCategories = Array.from(
        new Set([...(attribute.categories || []), ...parsedCategories])
      );

      attribute.values = mergedValues;
      attribute.categories = mergedCategories;
      await attribute.save();

      return res.status(200).json({
        success: true,
        message: `Attribute "${trimmedName}" updated with new values.`,
        data: attribute,
      });
    }

    // Create new Attribute
    attribute = await Attribute.create({
      name: trimmedName,
      slug,
      categories: parsedCategories,
      values: parsedValues,
      type: ["single", "multiple", "text"].includes(type) ? type : "single",
      status: "ACTIVE",
      isGlobal: false,
      createdByVendor: vendor ? vendor._id : null,
      createdByUser: req.user._id || req.user.id,
      description: String(description || "").trim(),
    });

    return res.status(201).json({
      success: true,
      message: `Attribute "${trimmedName}" created successfully!`,
      data: attribute,
    });
  } catch (error) {
    console.error("Error in createAttribute:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create attribute",
      error: error.message,
    });
  }
};

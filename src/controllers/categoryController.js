import Category from "../models/Category.js";

/**
 * @desc    Get all public categories (default top-level sorted by displayOrder)
 * @route   GET /api/categories
 * @access  Public
 */
export const getCategories = async (req, res, next) => {
  try {
    const { level, active = "true", all } = req.query;

    const query = {};
    if (active === "true") {
      query.isActive = true;
    }

    if (all !== "true") {
      if (level !== undefined) {
        query.level = Number(level);
      } else {
        // Default to top-level categories
        query.level = 0;
      }
    }

    const categories = await Category.find(query)
      .populate("parentCategory", "name slug")
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    const host = req.get("host");
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;

    // Normalize image URLs
    const formattedCategories = categories.map((cat) => {
      let fullImageUrl = cat.image || "";
      if (cat.image && cat.image.startsWith("/")) {
        fullImageUrl = `${baseUrl}${cat.image}`;
      }

      return {
        ...cat,
        imageUrl: fullImageUrl,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedCategories.length,
      data: formattedCategories,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single category by slug or id
 * @route   GET /api/categories/:slugOrId
 * @access  Public
 */
export const getCategoryBySlug = async (req, res, next) => {
  try {
    const { slugOrId } = req.params;

    let category = null;
    if (slugOrId.match(/^[0-9a-fA-F]{24}$/)) {
      category = await Category.findById(slugOrId).lean();
    }
    if (!category) {
      category = await Category.findOne({ slug: slugOrId }).lean();
    }

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get subcategories if any
    const subCategories = await Category.find({
      parentCategory: category._id,
      isActive: true,
    })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    const host = req.get("host");
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;

    let fullImageUrl = category.image || "";
    if (category.image && category.image.startsWith("/")) {
      fullImageUrl = `${baseUrl}${category.image}`;
    }

    return res.status(200).json({
      success: true,
      data: {
        ...category,
        imageUrl: fullImageUrl,
        subCategories: subCategories.map((sub) => ({
          ...sub,
          imageUrl: sub.image && sub.image.startsWith("/") ? `${baseUrl}${sub.image}` : sub.image,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

import Wishlist from "../models/Wishlist.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * @desc    Get current user's wishlist
 * @route   GET /api/wishlist
 * @access  Private
 */
export const getWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id;

    let wishlist = await Wishlist.findOne({ user: userId });

    if (!wishlist) {
      wishlist = await Wishlist.create({ user: userId, items: [] });
    }

    res.status(200).json({
      success: true,
      count: wishlist.items.length,
      data: wishlist.items,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle item in wishlist (add if missing, remove if present)
 * @route   POST /api/wishlist/toggle
 * @access  Private
 */
export const toggleWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      productId,
      name,
      price,
      originalPrice,
      image,
      imageUrl,
      weight,
      category,
      subCategory,
      rating,
      reviewsCount,
      isVeg,
      discountPct,
    } = req.body;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let wishlist = await Wishlist.findOne({ user: userId });

    if (!wishlist) {
      wishlist = new Wishlist({ user: userId, items: [] });
    }

    const existingIndex = wishlist.items.findIndex(
      (item) => String(item.productId) === String(productId)
    );

    let inWishlist = false;
    let message = "";

    if (existingIndex > -1) {
      // Remove from wishlist
      wishlist.items.splice(existingIndex, 1);
      inWishlist = false;
      message = "Item removed from wishlist";
    } else {
      // Add to wishlist
      wishlist.items.unshift({
        productId: String(productId),
        name: name || "Product",
        price: Number(price) || 0,
        originalPrice: Number(originalPrice) || Number(price) || 0,
        image: image || "",
        imageUrl: imageUrl || image || "",
        weight: weight || "",
        category: category || "",
        subCategory: subCategory || "",
        rating: Number(rating) || 4.5,
        reviewsCount: Number(reviewsCount) || 0,
        isVeg: isVeg !== undefined ? Boolean(isVeg) : true,
        discountPct: Number(discountPct) || 0,
        addedAt: new Date(),
      });
      inWishlist = true;
      message = "Item added to wishlist";
    }

    await wishlist.save();

    res.status(200).json({
      success: true,
      inWishlist,
      count: wishlist.items.length,
      data: wishlist.items,
      message,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add item to wishlist
 * @route   POST /api/wishlist/add
 * @access  Private
 */
export const addToWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      productId,
      name,
      price,
      originalPrice,
      image,
      imageUrl,
      weight,
      category,
      subCategory,
      rating,
      reviewsCount,
      isVeg,
      discountPct,
    } = req.body;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let wishlist = await Wishlist.findOne({ user: userId });

    if (!wishlist) {
      wishlist = new Wishlist({ user: userId, items: [] });
    }

    const exists = wishlist.items.some(
      (item) => String(item.productId) === String(productId)
    );

    if (!exists) {
      wishlist.items.unshift({
        productId: String(productId),
        name: name || "Product",
        price: Number(price) || 0,
        originalPrice: Number(originalPrice) || Number(price) || 0,
        image: image || "",
        imageUrl: imageUrl || image || "",
        weight: weight || "",
        category: category || "",
        subCategory: subCategory || "",
        rating: Number(rating) || 4.5,
        reviewsCount: Number(reviewsCount) || 0,
        isVeg: isVeg !== undefined ? Boolean(isVeg) : true,
        discountPct: Number(discountPct) || 0,
        addedAt: new Date(),
      });
      await wishlist.save();
    }

    res.status(200).json({
      success: true,
      inWishlist: true,
      count: wishlist.items.length,
      data: wishlist.items,
      message: "Item added to wishlist",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove item from wishlist
 * @route   DELETE /api/wishlist/remove/:productId
 * @access  Private
 */
export const removeFromWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { productId } = req.params;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let wishlist = await Wishlist.findOne({ user: userId });

    if (wishlist) {
      wishlist.items = wishlist.items.filter(
        (item) => String(item.productId) !== String(productId)
      );
      await wishlist.save();
    }

    res.status(200).json({
      success: true,
      inWishlist: false,
      count: wishlist ? wishlist.items.length : 0,
      data: wishlist ? wishlist.items : [],
      message: "Item removed from wishlist",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear entire wishlist
 * @route   DELETE /api/wishlist/clear
 * @access  Private
 */
export const clearWishlist = async (req, res, next) => {
  try {
    const userId = req.user._id;

    let wishlist = await Wishlist.findOne({ user: userId });

    if (wishlist) {
      wishlist.items = [];
      await wishlist.save();
    }

    res.status(200).json({
      success: true,
      count: 0,
      data: [],
      message: "Wishlist cleared successfully",
    });
  } catch (error) {
    next(error);
  }
};

import Cart from "../models/Cart.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Format cart response helper
 */
const formatCartResponse = (cart) => {
  const totals = cart.calculateTotals();
  return {
    items: cart.items,
    totalCount: totals.totalCount,
    totalPrice: totals.totalPrice,
    totalOriginalPrice: totals.totalOriginalPrice,
    totalSavings: totals.totalSavings,
  };
};

/**
 * @desc    Get current user's cart
 * @route   GET /api/cart
 * @access  Private
 */
export const getCart = async (req, res, next) => {
  try {
    const userId = req.user._id;

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    res.status(200).json({
      success: true,
      data: formatCartResponse(cart),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add item to cart or increment quantity
 * @route   POST /api/cart/add
 * @access  Private
 */
export const addToCart = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      productId,
      name,
      price,
      originalPrice,
      quantity = 1,
      imageUrl,
      weight,
      category,
      subCategory,
      isVeg,
    } = req.body;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    const existingIndex = cart.items.findIndex(
      (item) => String(item.productId) === String(productId)
    );

    const qtyToAdd = Math.max(1, Number(quantity) || 1);

    if (existingIndex > -1) {
      // Increment quantity
      cart.items[existingIndex].quantity += qtyToAdd;
      // Update price/details if provided
      if (price !== undefined) cart.items[existingIndex].price = Number(price);
      if (originalPrice !== undefined)
        cart.items[existingIndex].originalPrice = Number(originalPrice);
      if (imageUrl) cart.items[existingIndex].imageUrl = imageUrl;
    } else {
      // Add new cart item
      cart.items.unshift({
        productId: String(productId),
        name: name || "Product",
        price: Number(price) || 0,
        originalPrice: Number(originalPrice) || Number(price) || 0,
        quantity: qtyToAdd,
        imageUrl: imageUrl || "",
        weight: weight || "",
        category: category || "",
        subCategory: subCategory || "",
        isVeg: isVeg !== undefined ? Boolean(isVeg) : true,
        addedAt: new Date(),
      });
    }

    await cart.save();

    res.status(200).json({
      success: true,
      message: "Product added to cart",
      data: formatCartResponse(cart),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update quantity of specific item in cart (+1 / -1 or specific value)
 * @route   PUT /api/cart/update-quantity
 * @access  Private
 */
export const updateCartItemQuantity = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { productId, delta, quantity } = req.body;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = await Cart.create({ user: userId, items: [] });
    }

    const existingIndex = cart.items.findIndex(
      (item) => String(item.productId) === String(productId)
    );

    if (existingIndex > -1) {
      let newQty = cart.items[existingIndex].quantity;

      if (quantity !== undefined) {
        newQty = Number(quantity);
      } else if (delta !== undefined) {
        newQty += Number(delta);
      }

      if (newQty <= 0) {
        // Remove item
        cart.items.splice(existingIndex, 1);
      } else {
        cart.items[existingIndex].quantity = newQty;
      }

      await cart.save();
    }

    res.status(200).json({
      success: true,
      message: "Cart quantity updated",
      data: formatCartResponse(cart),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove product from cart
 * @route   DELETE /api/cart/remove/:productId
 * @access  Private
 */
export const removeFromCart = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { productId } = req.params;

    if (!productId) {
      return next(new AppError("Product ID is required", 400));
    }

    let cart = await Cart.findOne({ user: userId });

    if (cart) {
      cart.items = cart.items.filter(
        (item) => String(item.productId) !== String(productId)
      );
      await cart.save();
    }

    res.status(200).json({
      success: true,
      message: "Product removed from cart",
      data: cart ? formatCartResponse(cart) : { items: [], totalCount: 0, totalPrice: 0, totalOriginalPrice: 0, totalSavings: 0 },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Clear entire cart
 * @route   DELETE /api/cart/clear
 * @access  Private
 */
export const clearCart = async (req, res, next) => {
  try {
    const userId = req.user._id;

    let cart = await Cart.findOne({ user: userId });

    if (cart) {
      cart.items = [];
      await cart.save();
    }

    res.status(200).json({
      success: true,
      message: "Cart cleared successfully",
      data: {
        items: [],
        totalCount: 0,
        totalPrice: 0,
        totalOriginalPrice: 0,
        totalSavings: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Sync guest / offline cart items with backend cart
 * @route   POST /api/cart/sync
 * @access  Private
 */
export const syncCart = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { items = [] } = req.body;

    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    if (Array.isArray(items)) {
      items.forEach((incoming) => {
        const pId = String(incoming.id || incoming.productId || "");
        if (!pId) return;

        const existing = cart.items.find(
          (it) => String(it.productId) === pId
        );

        if (existing) {
          existing.quantity = Math.max(
            existing.quantity,
            Number(incoming.quantity) || 1
          );
        } else {
          cart.items.push({
            productId: pId,
            name: incoming.name || "Product",
            price: Number(incoming.price) || 0,
            originalPrice: Number(incoming.originalPrice) || Number(incoming.price) || 0,
            quantity: Math.max(1, Number(incoming.quantity) || 1),
            imageUrl: incoming.imageUrl || "",
            weight: incoming.weight || "",
            category: incoming.category || "",
            subCategory: incoming.subCategory || "",
            isVeg: incoming.isVeg !== undefined ? Boolean(incoming.isVeg) : true,
            addedAt: new Date(),
          });
        }
      });

      await cart.save();
    }

    res.status(200).json({
      success: true,
      message: "Cart synced successfully",
      data: formatCartResponse(cart),
    });
  } catch (error) {
    next(error);
  }
};

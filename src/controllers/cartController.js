import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import Address from "../models/Address.js";
import { calculateDistanceKm } from "../utils/dispatchEngine.js";
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

/**
 * @desc    Validate cart delivery availability and compute dynamic vendor distance & delivery estimate
 * @route   POST /api/cart/validate-delivery
 * @access  Private
 */
export const validateCartDelivery = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { latitude, longitude, addressId, items: clientItems } = req.body;

    let custLat = parseFloat(latitude);
    let custLng = parseFloat(longitude);

    // If coordinates were not explicitly passed, attempt to resolve from addressId or default saved address
    if (isNaN(custLat) || isNaN(custLng)) {
      if (addressId) {
        const addr = await Address.findOne({ _id: addressId, user: userId });
        if (addr && addr.latitude != null && addr.longitude != null) {
          custLat = parseFloat(addr.latitude);
          custLng = parseFloat(addr.longitude);
        }
      } else {
        const defAddr = await Address.findOne({ user: userId, isDefault: true });
        if (defAddr && defAddr.latitude != null && defAddr.longitude != null) {
          custLat = parseFloat(defAddr.latitude);
          custLng = parseFloat(defAddr.longitude);
        }
      }
    }

    // Determine cart items (either provided in payload or fetched from user's server cart)
    let cartItems = Array.isArray(clientItems) && clientItems.length > 0 ? clientItems : [];
    if (cartItems.length === 0) {
      const cart = await Cart.findOne({ user: userId });
      if (cart && Array.isArray(cart.items)) {
        cartItems = cart.items;
      }
    }

    if (cartItems.length === 0) {
      return res.status(200).json({
        success: true,
        allDeliverable: true,
        customerLocation: { latitude: custLat, longitude: custLng },
        vendorEstimates: [],
      });
    }

    // Resolve products from DB
    const productIds = cartItems
      .map((it) => it.productId || it.id || it._id)
      .filter((id) => id && String(id).match(/^[0-9a-fA-F]{24}$/));

    const dbProducts = await Product.find({
      _id: { $in: productIds },
      isDeleted: false,
    })
      .populate(
        "vendor",
        "businessDetails.businessName shippingLocations location deliveryRadiusKm isStoreOpen status"
      )
      .lean();

    // Group items by vendor
    const vendorMap = new Map();

    for (const item of cartItems) {
      const pId = String(item.productId || item.id || item._id);
      const prod = dbProducts.find((p) => String(p._id) === pId);
      if (!prod || !prod.vendor) continue;

      const vendor = prod.vendor;
      const vendorId = String(vendor._id || vendor.id);

      if (!vendorMap.has(vendorId)) {
        vendorMap.set(vendorId, {
          vendor,
          items: [],
        });
      }

      vendorMap.get(vendorId).items.push({
        productId: pId,
        name: prod.name,
        price: prod.price,
        quantity: item.quantity || 1,
        imageUrl: prod.images?.[0]?.url || item.imageUrl || "",
      });
    }

    const hasCustomerCoords = !isNaN(custLat) && !isNaN(custLng);
    const vendorEstimates = [];

    for (const [vendorId, entry] of vendorMap.entries()) {
      const vendor = entry.vendor;
      const vLat = parseFloat(
        vendor.shippingLocations?.latitude ?? vendor.location?.coordinates?.[1]
      );
      const vLng = parseFloat(
        vendor.shippingLocations?.longitude ?? vendor.location?.coordinates?.[0]
      );
      const radiusKm = Number(vendor.deliveryRadiusKm) || 5;
      const storeName = vendor.businessDetails?.businessName || "Partner Store";
      const isStoreOpen =
        vendor.isStoreOpen !== false &&
        ["approved", "active"].includes(vendor.status);

      let distanceKm = 0;
      let isWithinRadius = false;
      let estimatedDelivery = "15–25 mins";

      if (hasCustomerCoords && !isNaN(vLat) && !isNaN(vLng)) {
        distanceKm = calculateDistanceKm(custLat, custLng, vLat, vLng);
        isWithinRadius = distanceKm <= radiusKm;

        // Dynamic Blinkit-style delivery time calculation
        const minMins = Math.max(10, Math.round(8 + distanceKm * 2.5));
        const maxMins = minMins + 10;
        estimatedDelivery = `${minMins}–${maxMins} mins`;
      } else {
        isWithinRadius = true;
      }

      let isDeliverable = true;
      let reason = null;

      if (!isStoreOpen) {
        isDeliverable = false;
        reason = "Store is currently closed.";
      } else if (hasCustomerCoords && !isWithinRadius) {
        isDeliverable = false;
        reason = "Sorry, this store does not deliver to your selected location.";
      }

      vendorEstimates.push({
        vendorId,
        storeName,
        distanceKm,
        deliveryRadiusKm: radiusKm,
        estimatedDelivery,
        isDeliverable,
        isStoreOpen,
        reason,
        items: entry.items,
      });
    }

    const allDeliverable =
      vendorEstimates.length > 0 &&
      vendorEstimates.every((v) => v.isDeliverable);

    res.status(200).json({
      success: true,
      allDeliverable,
      hasMultipleVendors: vendorEstimates.length > 1,
      customerLocation: {
        latitude: hasCustomerCoords ? custLat : null,
        longitude: hasCustomerCoords ? custLng : null,
      },
      vendorEstimates,
    });
  } catch (error) {
    next(error);
  }
};

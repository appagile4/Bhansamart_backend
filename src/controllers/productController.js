import Product from "../models/Product.js";
import Vendor from "../models/Vendor.js";
import {
  uploadProductImageToCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinaryUpload.js";
import { generateSku, generateUniqueSlug } from "../utils/productUtils.js";

/**
 * Helper to resolve Vendor for logged-in user
 */
const resolveVendor = async (user) => {
  let vendor = await Vendor.findOne({ userId: user._id || user.id });
  if (!vendor) {
    // If not existing, create a default vendor document for this vendor user
    vendor = await Vendor.create({
      userId: user._id || user.id,
      businessDetails: {
        businessName: user.name || "Vendor Store",
        businessEmail: user.email || "",
      },
      sellerDetails: {
        sellerName: user.name || "",
        sellerEmail: user.email || "",
      },
      status: "active",
    });
  }
  return vendor;
};

/**
 * @desc    Create a new product with Cloudinary image uploads
 * @route   POST /api/products
 * @access  Private (Vendor / Admin)
 */
export const createProduct = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);

    const {
      name,
      description,
      shortDescription,
      category,
      subCategory,
      supplierName,
      brand,
      expirationDate,
      price,
      originalPrice,
      discountCategory,
      discountValue,
      sku,
      stock,
      reorderLevel,
      unit,
      status,
    } = req.body;

    if (!name || !category || price == null) {
      return res.status(400).json({
        success: false,
        message: "Product name, category, and selling price are required.",
      });
    }

    // 1. Generate unique slug & SKU
    const uniqueSlug = await generateUniqueSlug(name);
    const finalSku =
      sku && String(sku).trim().length > 0
        ? String(sku).trim()
        : generateSku(category);

    // 2. Parse JSON fields if passed as strings (from multipart/form-data)
    let parsedVariants = [];
    if (req.body.variants) {
      try {
        parsedVariants =
          typeof req.body.variants === "string"
            ? JSON.parse(req.body.variants)
            : req.body.variants;
      } catch {
        parsedVariants = [];
      }
    }

    let parsedTags = [];
    if (req.body.tags) {
      try {
        parsedTags =
          typeof req.body.tags === "string"
            ? JSON.parse(req.body.tags)
            : req.body.tags;
      } catch {
        parsedTags = [];
      }
    }

    let parsedVisibility = {
      isFeatured: false,
      isBestSeller: false,
      isNewArrival: false,
    };
    if (req.body.visibility) {
      try {
        parsedVisibility =
          typeof req.body.visibility === "string"
            ? JSON.parse(req.body.visibility)
            : req.body.visibility;
      } catch {
        // fallback
      }
    }

    // 3. Upload images to Cloudinary
    const uploadedImages = [];
    const vendorSlug =
      vendor.businessDetails?.businessName ||
      req.user.name ||
      "general-vendor";

    // A) Multer file buffers (multipart/form-data)
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const result = await uploadProductImageToCloudinary(
          file.buffer,
          vendorSlug
        );
        uploadedImages.push({
          url: result.url,
          publicId: result.publicId,
          altText: name,
        });
      }
    } else if (req.file) {
      const result = await uploadProductImageToCloudinary(
        req.file.buffer,
        vendorSlug
      );
      uploadedImages.push({
        url: result.url,
        publicId: result.publicId,
        altText: name,
      });
    }

    // B) Base64 or remote URI strings in req.body.images
    if (req.body.images) {
      let rawImages = req.body.images;
      if (typeof rawImages === "string") {
        try {
          rawImages = JSON.parse(rawImages);
        } catch {
          rawImages = [rawImages];
        }
      }

      if (Array.isArray(rawImages)) {
        for (const img of rawImages) {
          const imgStr = typeof img === "object" ? img.uri || img.url || img.base64 : img;
          if (imgStr && (imgStr.startsWith("data:") || imgStr.startsWith("http") || imgStr.startsWith("file:"))) {
            try {
              const result = await uploadProductImageToCloudinary(
                imgStr,
                vendorSlug
              );
              uploadedImages.push({
                url: result.url,
                publicId: result.publicId,
                altText: name,
              });
            } catch (imgErr) {
              console.warn("[Cloudinary] Image upload skipped for item:", imgErr.message);
            }
          }
        }
      }
    }

    // 4. Create Product in MongoDB
    const numPrice = Number(price) || 0;
    const numOriginalPrice = Number(originalPrice) || numPrice;
    const numStock = stock != null ? Number(stock) : 0;
    const numReorder = reorderLevel != null ? Number(reorderLevel) : 5;
    const numDiscountVal = Number(discountValue) || 0;

    const product = await Product.create({
      vendor: vendor._id,
      user: req.user._id || req.user.id,
      name: name.trim(),
      slug: uniqueSlug,
      description: description ? description.trim() : "",
      shortDescription: shortDescription ? shortDescription.trim() : "",
      category: category.trim(),
      subCategory: subCategory ? subCategory.trim() : "",
      supplierName: supplierName ? supplierName.trim() : "",
      brand: brand ? brand.trim() : "Generic / Store Brand",
      expirationDate: expirationDate ? expirationDate.trim() : "",
      price: numPrice,
      originalPrice: numOriginalPrice,
      discountCategory: discountCategory || "No Discount",
      discountValue: numDiscountVal,
      sku: finalSku,
      stock: numStock,
      reorderLevel: numReorder,
      unit: unit || "1 kg",
      inStock: numStock > 0,
      images: uploadedImages,
      variants: parsedVariants,
      tags: parsedTags,
      status: status || "Active",
      visibility: parsedVisibility,
    });

    res.status(201).json({
      success: true,
      message: "Product created and published successfully!",
      product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all products for current logged-in vendor
 * @route   GET /api/products/my-products
 * @access  Private (Vendor)
 */
export const getVendorProducts = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);

    const {
      search,
      category,
      status,
      stockStatus,
      minPrice,
      maxPrice,
      sortBy = "newest",
      page = 1,
      limit = 20,
    } = req.query;

    const query = {
      vendor: vendor._id,
      isDeleted: false,
    };

    // 1. Search Query
    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), "i");
      query.$or = [
        { name: regex },
        { sku: regex },
        { category: regex },
        { brand: regex },
      ];
    }

    // 2. Category Filter
    if (category && category !== "All") {
      query.category = category;
    }

    // 3. Status Filter
    if (status && status !== "All") {
      query.status = status;
    }

    // 4. Stock Status Filter
    if (stockStatus === "in_stock") {
      query.inStock = true;
    } else if (stockStatus === "out_of_stock") {
      query.inStock = false;
    }

    // 5. Price Range
    if (minPrice != null || maxPrice != null) {
      query.price = {};
      if (minPrice != null && !isNaN(Number(minPrice))) {
        query.price.$gte = Number(minPrice);
      }
      if (maxPrice != null && !isNaN(Number(maxPrice))) {
        query.price.$lte = Number(maxPrice);
      }
    }

    // 6. Sorting
    let sortObj = { createdAt: -1 };
    if (sortBy === "price_asc") {
      sortObj = { price: 1 };
    } else if (sortBy === "price_desc") {
      sortObj = { price: -1 };
    } else if (sortBy === "alpha") {
      sortObj = { name: 1 };
    } else if (sortBy === "oldest") {
      sortObj = { createdAt: 1 };
    }

    // 7. Pagination
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(query).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      products,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get single product by ID or Slug
 * @route   GET /api/products/:id
 * @access  Public / Protected
 */
export const getProductById = async (req, res, next) => {
  try {
    const { id } = req.params;
    let product;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findOne({ _id: id, isDeleted: false }).populate(
        "vendor",
        "businessDetails sellerDetails brandDetails"
      );
    } else {
      product = await Product.findOne({ slug: id, isDeleted: false }).populate(
        "vendor",
        "businessDetails sellerDetails brandDetails"
      );
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    res.status(200).json({
      success: true,
      product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update product details & images
 * @route   PUT /api/products/:id
 * @access  Private (Vendor)
 */
export const updateProduct = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      vendor: vendor._id,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or unauthorized.",
      });
    }

    // Upload new images to Cloudinary if provided
    const newImages = [...(product.images || [])];
    const vendorSlug =
      vendor.businessDetails?.businessName || req.user.name || "general";

    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const result = await uploadProductImageToCloudinary(
          file.buffer,
          vendorSlug
        );
        newImages.push({
          url: result.url,
          publicId: result.publicId,
          altText: req.body.name || product.name,
        });
      }
    }

    // Update fields
    const updates = { ...req.body };
    if (req.files && req.files.length > 0) {
      updates.images = newImages;
    }

    if (updates.variants && typeof updates.variants === "string") {
      try {
        updates.variants = JSON.parse(updates.variants);
      } catch {}
    }
    if (updates.tags && typeof updates.tags === "string") {
      try {
        updates.tags = JSON.parse(updates.tags);
      } catch {}
    }
    if (updates.visibility && typeof updates.visibility === "string") {
      try {
        updates.visibility = JSON.parse(updates.visibility);
      } catch {}
    }

    if (updates.stock != null) {
      updates.inStock = Number(updates.stock) > 0;
    }

    const updatedProduct = await Product.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      product: updatedProduct,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle product inStock / status
 * @route   PATCH /api/products/:id/toggle-stock
 * @access  Private (Vendor)
 */
export const toggleProductStock = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      vendor: vendor._id,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or unauthorized.",
      });
    }

    product.inStock = !product.inStock;
    if (!product.inStock) {
      product.status = "Not Active";
    } else {
      product.status = "Active";
      if (product.stock === 0) {
        product.stock = 10;
      }
    }

    await product.save();

    res.status(200).json({
      success: true,
      message: `Product is now ${product.inStock ? "Available" : "Disabled"}.`,
      inStock: product.inStock,
      status: product.status,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete product (soft delete)
 * @route   DELETE /api/products/:id
 * @access  Private (Vendor / Admin)
 */
export const deleteProduct = async (req, res, next) => {
  try {
    const vendor = await resolveVendor(req.user);
    const { id } = req.params;

    const product = await Product.findOne({
      _id: id,
      vendor: vendor._id,
      isDeleted: false,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found or unauthorized.",
      });
    }

    product.isDeleted = true;
    product.status = "archived";
    await product.save();

    // Optionally delete from Cloudinary
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        if (img.publicId) {
          deleteFromCloudinary(img.publicId).catch(() => {});
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

import Brand from "../models/Brand.js";
import Vendor from "../models/Vendor.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";

/**
 * Common popular curated brand logos for fast and reliable brand logo search
 */
const CURATED_BRAND_LOGOS = [
  { name: "Amul", domain: "amul.com", logoUrl: "https://logo.clearbit.com/amul.com", category: "Grocery & Kitchen" },
  { name: "Nestle", domain: "nestle.com", logoUrl: "https://logo.clearbit.com/nestle.com", category: "Grocery & Kitchen" },
  { name: "Everest", domain: "everestspices.com", logoUrl: "https://logo.clearbit.com/everestspices.com", category: "Grocery & Kitchen" },
  { name: "Tata", domain: "tata.com", logoUrl: "https://logo.clearbit.com/tata.com", category: "Grocery & Kitchen" },
  { name: "Dabur", domain: "dabur.com", logoUrl: "https://logo.clearbit.com/dabur.com", category: "Grocery & Kitchen" },
  { name: "Haldiram's", domain: "haldirams.com", logoUrl: "https://logo.clearbit.com/haldirams.com", category: "Snacks & Drinks" },
  { name: "Fortune", domain: "fortuneonline.in", logoUrl: "https://logo.clearbit.com/adaniwilmar.com", category: "Grocery & Kitchen" },
  { name: "Aashirvaad", domain: "itcportal.com", logoUrl: "https://logo.clearbit.com/itcportal.com", category: "Grocery & Kitchen" },
  { name: "Ponds", domain: "ponds.com", logoUrl: "https://logo.clearbit.com/ponds.com", category: "Beauty & Personal Care" },
  { name: "Nivea", domain: "nivea.com", logoUrl: "https://logo.clearbit.com/nivea.com", category: "Beauty & Personal Care" },
  { name: "Dove", domain: "dove.com", logoUrl: "https://logo.clearbit.com/dove.com", category: "Beauty & Personal Care" },
  { name: "Lakme", domain: "lakmeindia.com", logoUrl: "https://logo.clearbit.com/lakmeindia.com", category: "Beauty & Personal Care" },
  { name: "Pampers", domain: "pampers.com", logoUrl: "https://logo.clearbit.com/pampers.com", category: "Baby Care" },
  { name: "Himalaya", domain: "himalayawellness.com", logoUrl: "https://logo.clearbit.com/himalayawellness.com", category: "Beauty & Personal Care" },
  { name: "Coca-Cola", domain: "coca-cola.com", logoUrl: "https://logo.clearbit.com/coca-cola.com", category: "Snacks & Drinks" },
  { name: "Pepsi", domain: "pepsi.com", logoUrl: "https://logo.clearbit.com/pepsi.com", category: "Snacks & Drinks" },
  { name: "Britannia", domain: "britannia.co.in", logoUrl: "https://logo.clearbit.com/britannia.co.in", category: "Snacks & Drinks" },
  { name: "Parle", domain: "parleproducts.com", logoUrl: "https://logo.clearbit.com/parleproducts.com", category: "Snacks & Drinks" },
  { name: "Lays", domain: "lays.com", logoUrl: "https://logo.clearbit.com/lays.com", category: "Snacks & Drinks" },
  { name: "Colgate", domain: "colgate.com", logoUrl: "https://logo.clearbit.com/colgate.com", category: "Beauty & Personal Care" },
  { name: "Dettol", domain: "dettol.co.in", logoUrl: "https://logo.clearbit.com/dettol.co.in", category: "Cleaning & Household" },
  { name: "Surf Excel", domain: "hul.co.in", logoUrl: "https://logo.clearbit.com/hul.co.in", category: "Cleaning & Household" },
  { name: "Vim", domain: "hul.co.in", logoUrl: "https://logo.clearbit.com/hul.co.in", category: "Cleaning & Household" },
  { name: "Saffola", domain: "marico.com", logoUrl: "https://logo.clearbit.com/marico.com", category: "Grocery & Kitchen" },
  { name: "Maggi", domain: "maggi.in", logoUrl: "https://logo.clearbit.com/maggi.in", category: "Grocery & Kitchen" },
];

/**
 * Slug generator helper
 */
const generateBrandSlug = (name) => {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/**
 * @desc    Get active/approved brands (optionally filtered by category and search)
 * @route   GET /api/brands
 * @access  Public / Authenticated
 */
export const getBrands = async (req, res) => {
  try {
    const { category, search, status, page = 1, limit = 100 } = req.query;

    const query = {};

    // By default, public and product dropdowns only see APPROVED brands
    if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status.toUpperCase())) {
      query.status = status.toUpperCase();
    } else {
      query.status = "APPROVED";
    }

    // Filter by Category
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

    // Search by Name
    if (search && String(search).trim().length > 0) {
      query.name = { $regex: String(search).trim(), $options: "i" };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const [rawBrands, total] = await Promise.all([
      Brand.find(query)
        .sort({ isGlobal: -1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Brand.countDocuments(query),
    ]);

    // Normalize logo url for frontend ease of use
    const brands = rawBrands.map((b) => ({
      ...b,
      logo: typeof b.logo === "string" ? b.logo : b.logo?.url || "",
    }));

    return res.status(200).json({
      success: true,
      count: brands.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      brands,
      data: brands,
    });
  } catch (error) {
    console.error("Error in getBrands:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brands",
      error: error.message,
    });
  }
};

/**
 * @desc    Search brands quickly
 * @route   GET /api/brands/search
 * @access  Public
 */
export const searchBrands = async (req, res) => {
  try {
    const { q, category } = req.query;

    if (!q || String(q).trim().length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const query = {
      status: "APPROVED",
      name: { $regex: String(q).trim(), $options: "i" },
    };

    if (category && category !== "all" && category !== "All") {
      query.$or = [
        { categories: category },
        { categories: { $size: 0 } },
        { categories: { $exists: false } },
      ];
    }

    const brands = await Brand.find(query).limit(20).lean();

    return res.status(200).json({
      success: true,
      count: brands.length,
      data: brands,
    });
  } catch (error) {
    console.error("Error in searchBrands:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search brands",
      error: error.message,
    });
  }
};

/**
 * @desc    Search brand logos (curated + legitimate Clearbit CDN preview)
 * @route   GET /api/brands/logo-search
 * @access  Private (Vendor / Admin)
 */
export const searchBrandLogos = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || String(q).trim().length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const searchKeyword = String(q).trim().toLowerCase();

    // 1. Search in curated brand logo list
    const curatedMatches = CURATED_BRAND_LOGOS.filter((item) =>
      item.name.toLowerCase().includes(searchKeyword)
    );

    // 2. Also search if any approved brands already have a logo uploaded in DB
    const dbBrandsWithLogos = await Brand.find({
      name: { $regex: searchKeyword, $options: "i" },
      "logo.url": { $ne: "" },
    })
      .limit(5)
      .lean();

    const results = [];

    // Add existing DB brand logos
    dbBrandsWithLogos.forEach((b) => {
      if (b.logo && b.logo.url) {
        results.push({
          name: b.name,
          logoUrl: b.logo.url,
          source: "database",
          categories: b.categories,
        });
      }
    });

    // Add curated matches
    curatedMatches.forEach((c) => {
      if (!results.some((r) => r.name.toLowerCase() === c.name.toLowerCase())) {
        results.push({
          name: c.name,
          logoUrl: c.logoUrl,
          domain: c.domain,
          source: "official_cdn",
          category: c.category,
        });
      }
    });

    // If query looks like a brand name, add dynamic domain logo suggestion
    const cleanDomain = searchKeyword.replace(/[^a-z0-9]/g, "") + ".com";
    if (results.length < 5) {
      results.push({
        name: q.trim(),
        domain: cleanDomain,
        logoUrl: `https://logo.clearbit.com/${cleanDomain}`,
        source: "logo_search",
      });
    }

    return res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    console.error("Error in searchBrandLogos:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search brand logos",
      error: error.message,
    });
  }
};

/**
 * @desc    Submit a new brand request from Vendor Panel
 * @route   POST /api/vendor/brand-requests
 * @access  Private (Vendor / Admin)
 */
export const createBrandRequest = async (req, res) => {
  try {
    const { name, categories, description, logoUrl } = req.body;

    if (!name || String(name).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Brand name is required",
      });
    }

    const trimmedName = String(name).trim();
    const baseSlug = generateBrandSlug(trimmedName);

    // Resolve Vendor
    let vendor = await Vendor.findOne({ userId: req.user._id || req.user.id });
    if (!vendor) {
      vendor = await Vendor.create({
        userId: req.user._id || req.user.id,
        businessDetails: {
          businessName: req.user.name || "Vendor Store",
          businessEmail: req.user.email || "",
        },
        status: "active",
      });
    }

    // Check if brand already exists in the system
    const existingBrand = await Brand.findOne({
      $or: [
        { slug: baseSlug },
        { name: { $regex: `^${trimmedName}$`, $options: "i" } },
      ],
    });

    if (existingBrand) {
      if (existingBrand.status === "APPROVED") {
        return res.status(200).json({
          success: true,
          isExisting: true,
          message: `Brand "${existingBrand.name}" already exists and is approved! You can select it directly.`,
          data: existingBrand,
        });
      }

      if (
        existingBrand.status === "PENDING" &&
        existingBrand.createdByVendor?.toString() === vendor._id.toString()
      ) {
        return res.status(200).json({
          success: true,
          isPending: true,
          message: `You have already submitted a request for "${existingBrand.name}". It is currently Pending Approval.`,
          data: existingBrand,
        });
      }
    }

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

    // Handle logo upload
    let logoData = { url: "", publicId: null, source: "upload" };

    if (req.file) {
      const vendorSlug =
        vendor.businessDetails?.businessName || req.user.name || "vendor";
      const uploaded = await uploadToCloudinary(
        req.file.buffer,
        `bhansamart/brands/${generateBrandSlug(vendorSlug)}`
      );
      logoData = {
        url: uploaded.secure_url || uploaded.url,
        publicId: uploaded.public_id || null,
        source: "upload",
      };
    } else if (logoUrl && String(logoUrl).startsWith("http")) {
      logoData = {
        url: String(logoUrl).trim(),
        publicId: null,
        source: "search",
      };
    }

    // Generate unique slug
    let finalSlug = baseSlug;
    const countWithSlug = await Brand.countDocuments({ slug: baseSlug });
    if (countWithSlug > 0) {
      finalSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
    }

    // Create brand with PENDING status
    const newBrand = await Brand.create({
      name: trimmedName,
      slug: finalSlug,
      logo: logoData,
      categories: parsedCategories,
      description: description ? String(description).trim() : "",
      status: "PENDING",
      isGlobal: false,
      createdByVendor: vendor._id,
      createdByUser: req.user._id || req.user.id,
      rejectionReason: "",
    });

    return res.status(201).json({
      success: true,
      message: `Brand "${trimmedName}" request submitted successfully! Status: PENDING approval.`,
      data: newBrand,
    });
  } catch (error) {
    console.error("Error in createBrandRequest:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit brand request",
      error: error.message,
    });
  }
};

/**
 * @desc    Get vendor's own submitted brand requests with status tracking
 * @route   GET /api/vendor/brand-requests
 * @access  Private (Vendor / Admin)
 */
export const getMyBrandRequests = async (req, res) => {
  try {
    const vendor = await Vendor.findOne({ userId: req.user._id || req.user.id });
    if (!vendor) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const requests = await Brand.find({
      $or: [
        { createdByVendor: vendor._id },
        { createdByUser: req.user._id || req.user.id },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("Error in getMyBrandRequests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch brand requests",
      error: error.message,
    });
  }
};

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Refund, { maskCustomerPayoutDetails } from "../models/Refund.js";
import Brand from "../models/Brand.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import CodHandover from "../models/CodHandover.js";
import VendorTransaction from "../models/VendorTransaction.js";
import Notification from "../models/Notification.js";
import AuditLog from "../models/AuditLog.js";
import Ticket from "../models/Ticket.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { notifyStaffAdminsForVendor } from "../socket/socketManager.js";
import { processOrderRefund } from "../services/financeLedgerService.js";

/**
 * Helper: Resolve StaffAdmin's accessible vendor IDs.
 * Superadmin gets null (unrestricted global access).
 * StaffAdmin gets array of assigned Vendor ObjectIds.
 */
export const resolveStaffVendorScope = (req) => {
  if (req.user?.role === "superadmin") {
    return { isSuperAdmin: true, accessibleIds: null };
  }
  const assigned = (req.user?.assignedVendors || []).map((v) =>
    (v._id || v).toString()
  );
  return { isSuperAdmin: false, accessibleIds: assigned };
};

/**
 * Helper: Assert that the target vendor is accessible by the current StaffAdmin.
 */
export const assertVendorAccessible = (req, targetVendorId) => {
  const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
  if (isSuperAdmin) return true;
  const targetStr = (targetVendorId?._id || targetVendorId).toString();
  if (!accessibleIds.includes(targetStr)) {
    throw new AppError(
      "Access denied. You are not assigned to manage this vendor.",
      403
    );
  }
  return true;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. VENDOR ASSIGNED LIST & SUMMARY FOR CURRENT STAFF ADMIN
// ═══════════════════════════════════════════════════════════════════════════

export const getMyAssignedVendors = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const query = { status: { $ne: "deleted" } };

    if (!isSuperAdmin) {
      // Find vendors assigned either via user.assignedVendors OR vendor.assignedAdmin
      const directVendors = await Vendor.find({
        $or: [
          { assignedAdmin: req.user._id },
          { _id: { $in: (accessibleIds || []).filter((id) => id && mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id)) } },
        ],
      }).select("_id").lean();
      const validIds = directVendors.map((v) => v._id);
      query._id = { $in: validIds };
    }

    const vendors = await Vendor.find(query)
      .select("businessDetails sellerDetails brandDetails shippingLocations isStoreOpen isVerified status createdAt")
      .sort({ "businessDetails.businessName": 1 })
      .lean();

    const formattedVendors = vendors.map((v) => {
      const storeName =
        v.businessDetails?.businessName ||
        v.brandDetails?.brandName ||
        v.sellerDetails?.sellerName ||
        "Unnamed Store";
      const state =
        v.sellerDetails?.state ||
        v.shippingLocations?.state ||
        v.businessDetails?.state ||
        "Other";
      const city =
        v.sellerDetails?.city ||
        v.shippingLocations?.city ||
        v.businessDetails?.city ||
        "";

      return {
        ...v,
        storeName,
        name: storeName,
        state,
        city,
      };
    });

    res.status(200).json({
      success: true,
      count: formattedVendors.length,
      isSuperAdmin,
      vendors: formattedVendors,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 1.1 COMPLETE STAFFADMIN SCOPED DASHBOARD OVERVIEW & REAL-TIME STATS
// ═══════════════════════════════════════════════════════════════════════════

export const getStaffDashboardOverview = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const vendorId = req.query.vendorId;

    let vendorFilter = null;
    let vendorObjectIds = [];

    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      vendorFilter = new mongoose.Types.ObjectId(vendorId);
      vendorObjectIds = [vendorFilter];
    } else if (!isSuperAdmin) {
      vendorObjectIds = (accessibleIds || [])
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      vendorFilter = { $in: vendorObjectIds };
    }

    const { timeframe = "today", startDate, endDate } = req.query;

    // Date range calculation
    const now = new Date();
    let filterStart = new Date();
    let filterEnd = now;

    if (startDate && endDate) {
      filterStart = new Date(startDate);
      filterEnd = new Date(endDate);
      filterEnd.setHours(23, 59, 59, 999);
    } else {
      switch (timeframe) {
        case "today":
          filterStart.setHours(0, 0, 0, 0);
          break;
        case "yesterday":
          filterStart.setDate(now.getDate() - 1);
          filterStart.setHours(0, 0, 0, 0);
          filterEnd = new Date(filterStart);
          filterEnd.setHours(23, 59, 59, 999);
          break;
        case "7days":
        case "last7days":
          filterStart.setDate(now.getDate() - 7);
          break;
        case "30days":
        case "last30days":
          filterStart.setDate(now.getDate() - 30);
          break;
        case "thisMonth":
          filterStart = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          filterStart.setDate(now.getDate() - 7);
      }
    }

    const scopedVendorQuery = vendorFilter ? { _id: vendorFilter } : {};
    const scopedProductQuery = vendorFilter ? { vendor: vendorFilter } : {};
    const scopedOrderQuery = {
      ...(vendorFilter ? { vendor: vendorFilter } : {}),
      createdAt: { $gte: filterStart, $lte: filterEnd },
    };
    const scopedAllOrdersQuery = vendorFilter ? { vendor: vendorFilter } : {};

    // Parallel aggregate count lookups
    const [
      totalVendors,
      activeVendors,
      totalProducts,
      activeProducts,
      outOfStockProducts,
      ordersAgg,
      pendingRefundsCount,
      pendingBrandsCount,
      pendingWithdrawalsCount,
      openTicketsCount,
      activeDeliveriesCount,
      dailyTrendsAgg,
      recentOrders,
      recentRefunds,
    ] = await Promise.all([
      Vendor.countDocuments({ ...scopedVendorQuery, status: { $ne: "deleted" } }),
      Vendor.countDocuments({
        ...scopedVendorQuery,
        status: { $in: ["approved", "active"] },
        isStoreOpen: true,
      }),
      Product.countDocuments(scopedProductQuery),
      Product.countDocuments({ ...scopedProductQuery, status: "active", isActive: true }),
      Product.countDocuments({ ...scopedProductQuery, stock: { $lte: 0 } }),

      // Orders Aggregation in timeframe
      Order.aggregate([
        { $match: scopedOrderQuery },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            grossSales: { $sum: "$totalAmount" },
            deliveredOrders: {
              $sum: { $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, 1, 0] },
            },
            deliveredSales: {
              $sum: {
                $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, "$totalAmount", 0],
              },
            },
            cancelledOrders: {
              $sum: {
                $cond: [{ $in: ["$orderStatus", ["CANCELLED", "REJECTED"]] }, 1, 0],
              },
            },
            pendingOrders: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      "$orderStatus",
                      [
                        "PLACED",
                        "ACCEPTED",
                        "PREPARING",
                        "READY_FOR_PICKUP",
                        "OUT_FOR_DELIVERY",
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            codSales: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$orderStatus", "DELIVERED"] },
                      { $eq: ["$paymentMethod", "Cash on delivery"] },
                    ],
                  },
                  "$totalAmount",
                  0,
                ],
              },
            },
            onlineSales: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$orderStatus", "DELIVERED"] },
                      { $ne: ["$paymentMethod", "Cash on delivery"] },
                    ],
                  },
                  "$totalAmount",
                  0,
                ],
              },
            },
          },
        },
      ]),

      // Pending Queues (Action Items)
      Refund.countDocuments({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        status: { $in: ["PENDING", "UNDER_REVIEW", "STAFF_EXAMINATION_REQUIRED"] },
      }),
      Brand.countDocuments({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        status: { $in: ["PENDING", "UNDER_REVIEW"] },
      }),
      VendorTransaction.countDocuments({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        type: "WITHDRAWAL_REQUEST",
        status: "PENDING",
      }),
      Ticket.countDocuments({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        status: { $in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
      }),
      DeliveryAssignment.countDocuments({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] },
      }),

      // 7-day Daily Trends for Dashboard Chart
      Order.aggregate([
        {
          $match: {
            ...(vendorFilter ? { vendor: vendorFilter } : {}),
            createdAt: {
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            sales: {
              $sum: {
                $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, "$totalAmount", 0],
              },
            },
            ordersCount: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Recent 5 Orders
      Order.find(scopedAllOrdersQuery)
        .sort({ createdAt: -1 })
        .limit(5)
        .select(
          "orderNumber totalAmount orderStatus paymentMethod paymentStatus createdAt vendor items"
        )
        .populate(
          "vendor",
          "businessDetails.businessName brandDetails.brandName sellerDetails.sellerName"
        )
        .lean(),

      // Recent 5 Refunds awaiting review
      Refund.find({
        ...(vendorFilter ? { vendor: vendorFilter } : {}),
        status: { $in: ["PENDING", "UNDER_REVIEW", "STAFF_EXAMINATION_REQUIRED"] },
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select("refundNumber reason amount status createdAt vendor order")
        .populate("vendor", "businessDetails.businessName")
        .populate("order", "orderNumber totalAmount")
        .lean(),
    ]);

    const orderStats = ordersAgg[0] || {
      totalOrders: 0,
      grossSales: 0,
      deliveredOrders: 0,
      deliveredSales: 0,
      cancelledOrders: 0,
      pendingOrders: 0,
      codSales: 0,
      onlineSales: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        kpi: {
          totalVendors,
          activeVendors,
          inactiveVendors: Math.max(0, totalVendors - activeVendors),
          totalProducts,
          activeProducts,
          outOfStockProducts,
          totalOrders: orderStats.totalOrders,
          grossSales: orderStats.grossSales,
          deliveredSales: orderStats.deliveredSales,
          codSales: orderStats.codSales,
          onlineSales: orderStats.onlineSales,
          pendingOrders: orderStats.pendingOrders,
          deliveredOrders: orderStats.deliveredOrders,
          cancelledOrders: orderStats.cancelledOrders,
        },
        pendingTasks: {
          pendingRefunds: pendingRefundsCount,
          pendingBrands: pendingBrandsCount,
          pendingWithdrawals: pendingWithdrawalsCount,
          openTickets: openTicketsCount,
          activeDeliveries: activeDeliveriesCount,
          totalPendingTasks:
            pendingRefundsCount +
            pendingBrandsCount +
            pendingWithdrawalsCount +
            openTicketsCount,
        },
        dailyTrends: dailyTrendsAgg,
        recentOrders: recentOrders.map((o) => ({
          ...o,
          vendorName:
            o.vendor?.businessDetails?.businessName ||
            o.vendor?.brandDetails?.brandName ||
            o.vendor?.sellerDetails?.sellerName ||
            "Assigned Store",
        })),
        recentRefunds: recentRefunds.map((r) => ({
          ...r,
          vendorName: r.vendor?.businessDetails?.businessName || "Assigned Store",
          orderNumber: r.order?.orderNumber || "N/A",
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 1.2 COMPLETE STAFFADMIN SCOPED ORDERS LISTING
// ═══════════════════════════════════════════════════════════════════════════

export const getStaffOrders = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { vendorId, status, search, page = 1, limit = 50 } = req.query;

    let vendorFilter = null;
    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      vendorFilter = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      const validIds = (accessibleIds || [])
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      vendorFilter = { $in: validIds };
    }

    const query = vendorFilter ? { vendor: vendorFilter } : {};

    if (status && status !== "ALL") {
      query.orderStatus = status;
    }

    if (search) {
      query.orderNumber = { $regex: search.trim(), $options: "i" };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("vendor", "businessDetails.businessName name")
        .populate("customer", "name phone email")
        .populate("assignedDeliveryBoy", "fullName phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Order.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        orders,
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. COMPLETE VENDOR SALES AND PRODUCT ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

export const getVendorSalesAnalytics = async (req, res, next) => {
  try {
    const vendorId = req.params.vendorId || req.query.vendorId;
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);

    let vendorFilter = null;
    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      vendorFilter = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      vendorFilter = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    const { dateRange = "7d", range, startDate, endDate } = req.query;
    const activeRange = (range || dateRange || "7d").toLowerCase();

    // Calculate Date Thresholds
    const now = new Date();
    let filterStart = new Date();

    if (activeRange === "today") {
      filterStart.setHours(0, 0, 0, 0);
    } else if (activeRange === "yesterday") {
      filterStart.setDate(filterStart.getDate() - 1);
      filterStart.setHours(0, 0, 0, 0);
    } else if (activeRange === "7d" || activeRange === "7days") {
      filterStart.setDate(filterStart.getDate() - 7);
    } else if (activeRange === "30d" || activeRange === "30days") {
      filterStart.setDate(filterStart.getDate() - 30);
    } else if (activeRange === "monthly") {
      filterStart = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (activeRange === "custom" && startDate) {
      filterStart = new Date(startDate);
    } else if (activeRange === "all" || activeRange === "alltime" || activeRange === "lifetime") {
      filterStart = null;
    } else {
      filterStart.setDate(filterStart.getDate() - 7);
    }

    const dateFilter = {};
    if (filterStart) {
      dateFilter.createdAt = { $gte: filterStart };
    }
    if (vendorFilter) {
      dateFilter.vendor = vendorFilter;
    }
    if (activeRange === "yesterday" && filterStart) {
      const yesterdayEnd = new Date(filterStart);
      yesterdayEnd.setHours(23, 59, 59, 999);
      dateFilter.createdAt = { $gte: filterStart, $lte: yesterdayEnd };
    } else if (activeRange === "custom" && endDate) {
      dateFilter.createdAt = { ...(dateFilter.createdAt || {}), $lte: new Date(endDate) };
    }

    const refundMatch = {
      status: { $in: ["APPROVED", "PROCESSING", "COMPLETED"] },
    };
    if (filterStart) {
      refundMatch.createdAt = { $gte: filterStart };
    }
    if (vendorFilter) {
      refundMatch.vendor = vendorFilter;
    }

    // Aggregations: Sales Metrics
    const [salesSummary, ordersByStatus, categorySales, refundsSummary] =
      await Promise.all([
        Order.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              grossSales: { $sum: "$totalAmount" },
              completedOrdersCount: {
                $sum: {
                  $cond: [{ $eq: [{ $toUpper: "$orderStatus" }, "DELIVERED"] }, 1, 0],
                },
              },
              completedSales: {
                $sum: {
                  $cond: [{ $eq: [{ $toUpper: "$orderStatus" }, "DELIVERED"] }, "$totalAmount", 0],
                },
              },
              codSales: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ["$paymentMethod", "Cash on delivery"] },
                        { $eq: ["$paymentMethod", "Vendor QR Code (Direct)"] },
                        { $regexMatch: { input: { $ifNull: ["$paymentMethod", ""] }, regex: /cash|cod|qr/i } },
                      ],
                    },
                    "$totalAmount",
                    0,
                  ],
                },
              },
              onlineSales: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $ne: ["$paymentMethod", "Cash on delivery"] },
                        { $ne: ["$paymentMethod", "Vendor QR Code (Direct)"] },
                        { $not: [{ $regexMatch: { input: { $ifNull: ["$paymentMethod", ""] }, regex: /cash|cod|qr/i } }] },
                      ],
                    },
                    "$totalAmount",
                    0,
                  ],
                },
              },
              cancelledOrdersCount: {
                $sum: {
                  $cond: [{ $eq: [{ $toUpper: "$orderStatus" }, "CANCELLED"] }, 1, 0],
                },
              },
            },
          },
        ]),

        // Orders by Status
        Order.aggregate([
          { $match: dateFilter },
          {
            $group: {
              _id: "$orderStatus",
              count: { $sum: 1 },
              value: { $sum: "$totalAmount" },
            },
          },
        ]),

        // Sales by Category (with product lookup fallback)
        Order.aggregate([
          { $match: dateFilter },
          { $unwind: "$items" },
          {
            $lookup: {
              from: "products",
              localField: "items.product",
              foreignField: "_id",
              as: "productDoc",
            },
          },
          {
            $group: {
              _id: {
                $ifNull: [
                  {
                    $cond: [
                      { $and: [{ $ne: ["$items.category", ""] }, { $ne: ["$items.category", null] }] },
                      "$items.category",
                      { $arrayElemAt: ["$productDoc.category", 0] },
                    ],
                  },
                  "General",
                ],
              },
              count: { $sum: { $ifNull: ["$items.quantity", 1] } },
              totalSales: {
                $sum: {
                  $multiply: [
                    { $ifNull: ["$items.price", 0] },
                    { $ifNull: ["$items.quantity", 1] },
                  ],
                },
              },
            },
          },
          { $sort: { totalSales: -1 } },
          { $limit: 10 },
        ]),

        // Refunds Summary
        Refund.aggregate([
          { $match: refundMatch },
          {
            $group: {
              _id: null,
              refundsCount: { $sum: 1 },
              totalRefundAmount: { $sum: "$amount" },
              completedRefundsCount: {
                $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
              },
              completedRefundAmount: {
                $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$amount", 0] },
              },
            },
          },
        ]),
      ]);

    const summary = salesSummary[0] || {
      totalOrders: 0,
      grossSales: 0,
      completedOrdersCount: 0,
      completedSales: 0,
      codSales: 0,
      onlineSales: 0,
      cancelledOrdersCount: 0,
    };

    const refunds = refundsSummary[0] || {
      refundsCount: 0,
      totalRefundAmount: 0,
      completedRefundsCount: 0,
      completedRefundAmount: 0,
    };

    // Net sales: Real completed delivered sales minus actually completed refunds
    const completedOrGross = summary.completedSales > 0 ? summary.completedSales : summary.grossSales;
    const netSales = Math.max(0, completedOrGross - (refunds.completedRefundAmount || refunds.totalRefundAmount || 0));
    const returnRefundRate =
      summary.totalOrders > 0
        ? parseFloat(((refunds.refundsCount / summary.totalOrders) * 100).toFixed(2))
        : 0;

    // Daily Sales Timeline (for trend graphs)
    const timelineMatch = {
      orderStatus: { $ne: "CANCELLED" },
    };
    if (filterStart) {
      timelineMatch.createdAt = { $gte: filterStart };
    }
    if (vendorFilter) {
      timelineMatch.vendor = vendorFilter;
    }
    const timeline = await Order.aggregate([
      { $match: timelineMatch },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          sales: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Top Selling Products (with lookup fallback)
    const topProducts = await Order.aggregate([
      { $match: dateFilter },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productDoc",
        },
      },
      {
        $group: {
          _id: { $ifNull: ["$items.product", "$items.productId"] },
          name: {
            $first: {
              $ifNull: ["$items.name", { $arrayElemAt: ["$productDoc.name", 0] }, "Product"],
            },
          },
          imageUrl: {
            $first: {
              $ifNull: [
                "$items.imageUrl",
                { $arrayElemAt: ["$productDoc.images.0", 0] },
                "",
              ],
            },
          },
          price: { $first: { $ifNull: ["$items.price", 0] } },
          unitsSold: { $sum: { $ifNull: ["$items.quantity", 1] } },
          totalRevenue: {
            $sum: {
              $multiply: [
                { $ifNull: ["$items.price", 0] },
                { $ifNull: ["$items.quantity", 1] },
              ],
            },
          },
        },
      },
      { $sort: { unitsSold: -1 } },
      { $limit: 8 },
    ]);

    const analyticsData = {
      summary: {
        totalOrders: summary.totalOrders,
        orderCount: summary.totalOrders,
        grossSales: summary.grossSales,
        completedOrders: summary.completedOrdersCount,
        completedSales: summary.completedSales,
        netSales,
        codSales: summary.codSales,
        onlineSales: summary.onlineSales,
        cancelledOrders: summary.cancelledOrdersCount,
        returnedOrders: refunds.refundsCount,
        returnRefundRate,
      },
      categoryBreakdown: categorySales.map((c) => ({
        category: c._id || "General",
        unitsSold: c.count,
        revenue: c.totalSales,
      })),
      topSellingProducts: topProducts.map((p) => ({
        productId: p._id,
        name: p.name,
        imageUrl: p.imageUrl,
        price: p.price,
        unitsSold: p.unitsSold,
        revenue: p.totalRevenue,
      })),
      timeline: timeline.map((t) => ({
        date: t._id,
        sales: t.sales,
        orders: t.orders,
      })),
      ordersByStatus,
    };

    res.status(200).json({
      success: true,
      analytics: analyticsData,
      data: {
        vendorId: vendorId || "all",
        dateRange: activeRange,
        metrics: {
          totalOrders: summary.totalOrders,
          grossSales: summary.grossSales,
          completedSales: summary.completedSales,
          netSales,
          codSales: summary.codSales,
          onlineSales: summary.onlineSales,
          cancelledOrdersCount: summary.cancelledOrdersCount,
          refundsCount: refunds.refundsCount,
          totalRefundAmount: refunds.totalRefundAmount,
          returnRefundRate,
        },
        ordersByStatus,
        categorySales: analyticsData.categoryBreakdown,
        topProducts: analyticsData.topSellingProducts,
        timeline: analyticsData.timeline,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getVendorProductsAnalytics = async (req, res, next) => {
  try {
    const vendorId = req.params.vendorId || req.query.vendorId;
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);

    const {
      page = 1,
      limit = 15,
      search = "",
      category = "",
      status = "",
    } = req.query;

    const query = {
      isDeleted: false,
    };

    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      query.vendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      query.vendor = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (search.trim()) {
      query.name = { $regex: search.trim(), $options: "i" };
    }
    if (category.trim()) {
      query.category = category.trim();
    }
    if (status.trim()) {
      query.status = status.trim();
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(query)
        .select(
          "name images sku category subCategory price originalPrice stock status inStock isReturnable returnWindowDays isReplaceable isRefundable variants ordersCount refundsCount conversionRate returnRefundRate createdAt updatedAt"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Product.countDocuments(query),
    ]);

    // Enhance each product with sales and refund statistics
    const enhancedProducts = products.map((p) => {
      const unitsSold = p.ordersCount || 0;
      const returnedUnits = p.refundsCount || 0;
      const grossSales = unitsSold * (p.price || 0);
      const netSales = Math.max(0, grossSales - returnedUnits * (p.price || 0));
      const firstImage = Array.isArray(p.images) && p.images.length > 0
        ? (typeof p.images[0] === "string" ? p.images[0] : p.images[0]?.url || "")
        : "";

      return {
        ...p,
        title: p.name,
        name: p.name,
        imageUrl: firstImage,
        unitsSold,
        returnedUnits,
        grossSales,
        netSales,
        lastSaleDate: p.updatedAt,
      };
    });

    res.status(200).json({
      success: true,
      total,
      products: enhancedProducts,
      pagination: {
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. DELIVERY BOY ASSIGNMENT & TRACKING
// ═══════════════════════════════════════════════════════════════════════════

export const getDeliveryAssignmentsAdmin = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { status, vendorId, page = 1, limit = 20 } = req.query;

    const query = {};

    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      query.vendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      query.vendor = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (status && status !== "ALL") {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [assignments, total] = await Promise.all([
      DeliveryAssignment.find(query)
        .populate("deliveryBoy", "fullName phone email approvalStatus availability currentLocation lastLocationUpdatedAt")
        .populate("vendor", "businessDetails.businessName brandDetails.brandLogo")
        .populate({
          path: "order",
          select: "orderNumber totalAmount paymentMethod orderStatus items shippingAddress customer createdAt",
          populate: {
            path: "customer",
            select: "name phone email",
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      DeliveryAssignment.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      assignments,
    });
  } catch (error) {
    next(error);
  }
};

export const getDeliveryBoyProfileAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);

    const deliveryBoy = await DeliveryBoy.findById(id).lean();
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner not found", 404));
    }

    // Filter assignments strictly to StaffAdmin's assigned vendors
    const vendorMatch = isSuperAdmin
      ? {}
      : {
          vendor: {
            $in: accessibleIds.map((vId) => new mongoose.Types.ObjectId(vId)),
          },
        };

    const assignments = await DeliveryAssignment.find({
      deliveryBoy: deliveryBoy._id,
      ...vendorMatch,
    })
      .populate("order", "orderNumber totalAmount paymentMethod orderStatus items createdAt")
      .populate("vendor", "businessDetails.businessName")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    // COD Collections Summary for assigned vendors
    const codHandovers = await CodHandover.find({
      deliveryBoy: deliveryBoy._id,
      ...vendorMatch,
    })
      .populate("vendor", "businessDetails.businessName")
      .sort({ verifiedAt: -1 })
      .lean();

    const totalSubmitted = codHandovers.reduce(
      (acc, h) => acc + (h.amountSubmitted || 0),
      0
    );

    res.status(200).json({
      success: true,
      deliveryBoy,
      deliveries: assignments,
      codHandovers,
      totalSubmitted,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. DELIVERY BOY CASH AND COD RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════

export const getDeliveryCodReconciliationAdmin = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { vendorId } = req.query;

    const vendorFilter = {};
    if (vendorId) {
      assertVendorAccessible(req, vendorId);
      vendorFilter.vendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      vendorFilter.vendor = {
        $in: accessibleIds.map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    // 1. Group delivered COD orders by deliveryBoy & vendor
    const deliveredCodOrders = await Order.aggregate([
      {
        $match: {
          orderStatus: "DELIVERED",
          paymentMethod: "Cash on delivery",
          ...vendorFilter,
        },
      },
      {
        $lookup: {
          from: "deliveryassignments",
          let: { ordId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$order", "$$ordId"] },
                    { $eq: ["$status", "COMPLETED"] },
                  ],
                },
              },
            },
          ],
          as: "assignment",
        },
      },
      { $unwind: { path: "$assignment", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: {
            deliveryBoy: "$assignment.deliveryBoy",
            vendor: "$vendor",
          },
          ordersCount: { $sum: 1 },
          expectedAmount: { $sum: "$totalAmount" },
          orderIds: { $push: "$_id" },
        },
      },
    ]);

    // 2. Fetch Handover records for matched delivery boys & vendors
    const handovers = await CodHandover.find(vendorFilter).lean();

    // 3. Assemble Detailed Ledger Reconciliation
    const reconciliation = await Promise.all(
      deliveredCodOrders
        .filter((d) => d._id && d._id.deliveryBoy)
        .map(async (row) => {
          const [dboy, vend, groupOrders] = await Promise.all([
            DeliveryBoy.findById(row._id.deliveryBoy).select("fullName phone availability").lean(),
            Vendor.findById(row._id.vendor).select("businessDetails.businessName").lean(),
            Order.find({ _id: { $in: row.orderIds } })
              .select("orderNumber totalAmount codDetails deliveredAt")
              .lean(),
          ]);

          const matchingHandovers = handovers.filter(
            (h) =>
              h.deliveryBoy?.toString() === row._id.deliveryBoy.toString() &&
              h.vendor?.toString() === row._id.vendor.toString()
          );

          const totalSubmitted = matchingHandovers.reduce(
            (acc, h) => acc + (h.amountSubmitted || 0),
            0
          );

          const expectedCod = row.expectedAmount || 0;
          const totalCollected = groupOrders.reduce(
            (sum, o) => sum + (o.codDetails?.amountCollected || o.codDetails?.cashCollectedAmount || o.totalAmount || 0),
            0
          );
          const totalHandedOver = groupOrders.reduce(
            (sum, o) => sum + (o.codDetails?.amountHandedOver || (o.codDetails?.cashSubmittedToVendor ? o.totalAmount : 0)),
            0
          );
          const totalVendorConfirmed = groupOrders.reduce(
            (sum, o) => sum + (o.codDetails?.vendorConfirmed ? (o.codDetails?.amountHandedOver || o.totalAmount) : 0),
            0
          );

          const discrepancies = groupOrders.filter(
            (o) => o.codDetails?.status === "DISCREPANCY_REPORTED" || o.codDetails?.discrepancy?.hasDiscrepancy
          );

          const outstanding = Math.max(0, expectedCod - totalSubmitted);
          const isDisputed = outstanding > 0 && row.ordersCount > 2;

          return {
            deliveryBoyId: row._id.deliveryBoy,
            deliveryBoyName: dboy?.fullName || "Unassigned Partner",
            phone: dboy?.phone || "",
            vendorId: row._id.vendor,
            vendorName: vend?.businessDetails?.businessName || "Store",
            ordersCount: row.ordersCount,
            expectedCod,
            totalCollected,
            totalHandedOver,
            totalVendorConfirmed,
            totalSubmitted,
            outstanding,
            discrepanciesCount: discrepancies.length,
            discrepancies: discrepancies.map((d) => ({
              orderId: d._id,
              orderNumber: d.orderNumber,
              expectedAmount: d.codDetails?.discrepancy?.expectedAmount || d.totalAmount,
              actualAmount: d.codDetails?.discrepancy?.actualAmount || 0,
              shortfall: d.codDetails?.discrepancy?.shortfall || 0,
              reason: d.codDetails?.discrepancy?.reason || "",
              reportedAt: d.codDetails?.discrepancy?.reportedAt,
            })),
            reconciliationStatus:
              discrepancies.length > 0
                ? "DISCREPANCY_REPORTED"
                : outstanding === 0
                  ? "RECONCILED"
                  : isDisputed
                    ? "MISMATCH_DISPUTE"
                    : "AWAITING_HANDOVER",
            handoversCount: matchingHandovers.length,
            recentReceipts: matchingHandovers.slice(-3).map((h) => h.receiptNumber),
            orders: groupOrders.map((o) => ({
              orderId: o._id,
              orderNumber: o.orderNumber,
              amountDue: o.codDetails?.amountDue || o.totalAmount,
              amountCollected: o.codDetails?.amountCollected || o.codDetails?.cashCollectedAmount || 0,
              amountHandedOver: o.codDetails?.amountHandedOver || 0,
              status: o.codDetails?.status || "COD_PENDING",
              cashCollectedAt: o.codDetails?.cashCollectedAt || o.deliveredAt,
              cashSubmittedAt: o.codDetails?.cashSubmittedAt,
              vendorConfirmed: o.codDetails?.vendorConfirmed || false,
              vendorConfirmedAt: o.codDetails?.vendorConfirmedAt,
              discrepancy: o.codDetails?.discrepancy,
              auditHistory: o.codDetails?.auditHistory,
            })),
          };
        })
    );

    const summary = {
      totalGroups: reconciliation.length,
      totalOrders: deliveredCodOrders.reduce((acc, r) => acc + (r.ordersCount || 0), 0),
      totalExpectedCod: reconciliation.reduce((acc, r) => acc + (r.expectedCod || 0), 0),
      totalCollected: reconciliation.reduce((acc, r) => acc + (r.totalCollected || 0), 0),
      totalHandedOver: reconciliation.reduce((acc, r) => acc + (r.totalHandedOver || 0), 0),
      totalVendorConfirmed: reconciliation.reduce((acc, r) => acc + (r.totalVendorConfirmed || 0), 0),
      totalOutstanding: reconciliation.reduce((acc, r) => acc + (r.outstanding || 0), 0),
      totalDiscrepancies: reconciliation.reduce((acc, r) => acc + (r.discrepanciesCount || 0), 0),
    };

    res.status(200).json({
      success: true,
      summary,
      reconciliation,
    });
  } catch (error) {
    next(error);
  }
};

export const raiseCodDisputeAdmin = async (req, res, next) => {
  try {
    const { deliveryBoyId, vendorId, notes, disputedAmount } = req.body;
    assertVendorAccessible(req, vendorId);

    // Create Audit Log entry for the dispute
    await AuditLog.create({
      action: "COD_DISPUTE_RAISED",
      performedBy: req.user._id,
      targetEntity: "DeliveryBoy",
      targetId: deliveryBoyId,
      details: `StaffAdmin ${req.user.name} flagged COD collection mismatch of NPR ${disputedAmount}. Note: ${notes}`,
    });

    // Notify Superadmin and Vendor
    await notifyStaffAdminsForVendor({
      vendorId,
      eventType: "staff_cod:dispute",
      title: "COD Reconciliation Discrepancy Flagged",
      message: `StaffAdmin flagged NPR ${disputedAmount} discrepancy for delivery partner. Review required.`,
      data: { deliveryBoyId, disputedAmount, notes },
    });

    res.status(200).json({
      success: true,
      message: "COD collection dispute recorded and escalated to financial audit.",
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. WITHDRAWAL REQUEST MONITORING (STAFFADMIN SCOPED)
// ═══════════════════════════════════════════════════════════════════════════

export const getVendorWithdrawalsAdmin = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { status, vendorId, page = 1, limit = 20 } = req.query;

    const query = {
      type: { $in: ["WITHDRAWAL", "WITHDRAWAL_REQUEST"] },
    };

    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      query.vendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      query.vendor = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (status && status !== "ALL") {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [withdrawals, total] = await Promise.all([
      VendorTransaction.find(query)
        .populate("vendor", "businessDetails.businessName sellerDetails.sellerName wallet.currentBalance")
        .populate("reviewedBy", "name email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      VendorTransaction.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

export const examineVendorWithdrawalAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { internalNotes, escalationAction = "FORWARD_TO_FINANCE", rejectionReason } = req.body;

    const txn = await VendorTransaction.findById(id).populate("vendor");
    if (!txn) {
      return next(new AppError("Withdrawal request not found", 404));
    }

    assertVendorAccessible(req, txn.vendor._id);

    // Rule: StaffAdmin CANNOT execute financial payout or change wallet balance directly
    if (req.user.role !== "superadmin" && req.body.status === "COMPLETED") {
      return next(
        new AppError(
          "StaffAdmin is not authorized to execute payouts. Financial authorization is restricted to Superadmin/Finance.",
          403
        )
      );
    }

    txn.internalNotes = internalNotes || txn.internalNotes;
    txn.reviewedBy = req.user._id;

    if (escalationAction === "FORWARD_TO_FINANCE") {
      txn.escalationStatus = "EXAMINED_ESCALATED";
    } else if (escalationAction === "REQUEST_INFO") {
      txn.escalationStatus = "INFO_REQUESTED";
    } else if (escalationAction === "REJECT" && req.user.role === "superadmin") {
      txn.status = "FAILED";
      txn.rejectionReason = rejectionReason || "Rejected by finance review";
    }

    await txn.save();

    // Real-time alert
    await notifyStaffAdminsForVendor({
      vendorId: txn.vendor._id,
      eventType: "staff_withdrawal:updated",
      title: "Withdrawal Request Examined",
      message: `StaffAdmin ${req.user.name} reviewed withdrawal request of NPR ${txn.amount} and forwarded to Finance.`,
      data: { withdrawalId: txn._id, amount: txn.amount, status: txn.status },
    });

    res.status(200).json({
      success: true,
      message: "Withdrawal request examined and operational notes attached.",
      data: txn,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. BRAND CREATION AND APPROVAL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export const getBrandsReviewQueueAdmin = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { status = "ALL", page = 1, limit = 20, vendorId, search } = req.query;

    const query = {};
    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      query.createdByVendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      query.createdByVendor = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (status && status !== "all" && status !== "ALL") {
      query.status = status.toUpperCase();
    }

    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: "i" };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [brands, total] = await Promise.all([
      Brand.find(query)
        .populate("createdByVendor", "businessDetails.businessName brandDetails.brandLogo")
        .populate("reviewedBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Brand.countDocuments(query),
    ]);

    // Check duplicate similarity warnings for each pending brand
    const existingApproved = await Brand.find({ status: "APPROVED" })
      .select("name")
      .lean();
    const approvedNames = existingApproved.map((b) => b.name.toLowerCase().trim());

    const brandsWithWarnings = brands.map((b) => {
      const bName = b.name.toLowerCase().trim();
      const isDuplicate = approvedNames.some(
        (an) => an === bName || (an.includes(bName) && an.length < bName.length + 3)
      );
      const logoUrl = typeof b.logo === "object" ? b.logo?.url : b.logo;
      return {
        ...b,
        logo: logoUrl || "",
        vendor: {
          storeName: b.createdByVendor?.businessDetails?.businessName || "Vendor",
          ...b.createdByVendor,
        },
        similarityWarning: isDuplicate
          ? "A brand with a very similar name already exists in the approved registry."
          : null,
      };
    });

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      brands: brandsWithWarnings,
    });
  } catch (error) {
    next(error);
  }
};

export const reviewBrandAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, reviewerNotes = "", rejectionReason = "" } = req.body;

    const brand = await Brand.findById(id).populate("createdByVendor");
    if (!brand) {
      return next(new AppError("Brand request not found", 404));
    }

    if (brand.createdByVendor) {
      assertVendorAccessible(req, brand.createdByVendor._id);
    }

    if (action === "APPROVE") {
      brand.status = "APPROVED";
      brand.rejectionReason = "";
    } else if (action === "REJECT") {
      brand.status = "REJECTED";
      brand.rejectionReason = rejectionReason || "Rejected by brand review policy.";
    }

    brand.reviewerNotes = reviewerNotes;
    brand.reviewedBy = req.user._id;
    brand.reviewedAt = new Date();
    await brand.save();

    // Real-time alert to vendor & staff
    if (brand.createdByVendor) {
      await notifyStaffAdminsForVendor({
        vendorId: brand.createdByVendor._id,
        eventType: "staff_brand:updated",
        title: `Brand Request ${brand.status}`,
        message: `Brand "${brand.name}" was ${brand.status.toLowerCase()} by ${req.user.name}.`,
        data: { brandId: brand._id, status: brand.status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Brand has been ${brand.status.toLowerCase()} successfully.`,
      brand,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. RETURN, REFUND, REPLACEMENT & EXCHANGE WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════

export const getRefundsQueueAdmin = async (req, res, next) => {
  try {
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);
    const { status = "ALL", claimType, page = 1, limit = 20, vendorId } = req.query;

    const query = {};
    if (vendorId && vendorId !== "all") {
      assertVendorAccessible(req, vendorId);
      query.vendor = new mongoose.Types.ObjectId(vendorId);
    } else if (!isSuperAdmin) {
      query.vendor = {
        $in: (accessibleIds || []).map((id) => new mongoose.Types.ObjectId(id)),
      };
    }

    if (status && status !== "ALL" && status !== "all") {
      query.status = status;
    }
    if (claimType && claimType !== "ALL" && claimType !== "all") {
      query.claimType = claimType;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rawRefunds, total, pendingCount, approvedCount, completedCount, rejectedCount] = await Promise.all([
      Refund.find(query)
        .populate("vendor", "businessDetails.businessName brandDetails.brandLogo")
        .populate("customer", "name phone email")
        .populate({
          path: "order",
          select: "orderNumber totalAmount paymentMethod orderStatus items shippingAddress codDetails",
        })
        .populate("pickup.deliveryBoy", "fullName phone availability")
        .populate("staffReview.reviewer", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Refund.countDocuments(query),
      Refund.countDocuments({ ...query, status: { $in: ["REQUESTED", "VENDOR_REVIEW", "VENDOR_INFO_REQUIRED"] } }),
      Refund.countDocuments({ ...query, status: { $in: ["APPROVED", "STAFF_EXAMINING", "FORWARDED_TO_FINANCE", "RETURN_PICKUP_SCHEDULED", "RETURN_PICKED_UP", "RETURN_RECEIVED", "INSPECTED_PASSED"] } }),
      Refund.countDocuments({ ...query, status: "COMPLETED" }),
      Refund.countDocuments({ ...query, status: { $in: ["REJECTED", "VENDOR_REJECTED", "FAILED", "INSPECTED_FAILED"] } }),
    ]);

    const refunds = rawRefunds.map((r) => ({
      ...r,
      customerPayoutDetails: maskCustomerPayoutDetails(r.customerPayoutDetails),
    }));

    res.status(200).json({
      success: true,
      total,
      summary: {
        total,
        pending: pendingCount,
        approved: approvedCount,
        completed: completedCount,
        rejected: rejectedCount,
      },
      refunds,
      pagination: {
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const staffExamineRefundAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      notes = "",
      action = "FORWARD_TO_FINANCE", // FORWARD_TO_FINANCE | SCHEDULE_PICKUP | REJECT
      rejectionReason = "",
    } = req.body;

    const refund = await Refund.findById(id).populate("vendor order");
    if (!refund) {
      return next(new AppError("Return / Refund claim not found", 404));
    }

    assertVendorAccessible(req, refund.vendor._id);

    // Rule: StaffAdmin cannot transfer money directly. They examine operational validity.
    refund.staffReview = {
      reviewer: req.user._id,
      reviewerName: req.user.name,
      notes,
      isExamined: true,
      examinedAt: new Date(),
      forwardedToFinance: action === "FORWARD_TO_FINANCE",
      forwardedAt: action === "FORWARD_TO_FINANCE" ? new Date() : null,
    };

    if (action === "FORWARD_TO_FINANCE") {
      refund.status = "FORWARDED_TO_FINANCE";
    } else if (action === "SCHEDULE_PICKUP") {
      refund.status = "RETURN_PICKUP_SCHEDULED";
      refund.pickup.required = true;
      refund.pickup.status = "PENDING_ASSIGNMENT";
    } else if (action === "REJECT") {
      refund.status = "REJECTED";
      refund.rejectionReason = rejectionReason || "Rejected during operational examination";
    }

    refund.timeline.push({
      status: refund.status,
      actorRole: req.user.role,
      actorName: req.user.name,
      notes: notes || `StaffAdmin examination action: ${action}`,
      timestamp: new Date(),
    });

    await refund.save();

    // Alert Superadmin & Vendor
    await notifyStaffAdminsForVendor({
      vendorId: refund.vendor._id,
      eventType: "staff_refund:updated",
      title: "Claim Examined by StaffAdmin",
      message: `Return claim ${refund.refundNumber} examined: ${refund.status}`,
      data: { refundId: refund._id, status: refund.status },
    });

    res.status(200).json({
      success: true,
      message: `Claim status updated to ${refund.status}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

export const updateRefundPickupAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deliveryBoyId, pickupStatus, notes = "" } = req.body;

    const refund = await Refund.findById(id).populate("vendor");
    if (!refund) {
      return next(new AppError("Claim not found", 404));
    }

    assertVendorAccessible(req, refund.vendor._id);

    if (deliveryBoyId) {
      refund.pickup.deliveryBoy = deliveryBoyId;
      refund.pickup.status = "ASSIGNED";
      refund.pickup.scheduledAt = new Date();
    }
    if (pickupStatus) {
      refund.pickup.status = pickupStatus;
      if (pickupStatus === "PICKED_UP") {
        refund.pickup.pickedUpAt = new Date();
        refund.status = "RETURN_PICKED_UP";
      } else if (pickupStatus === "RECEIVED_AT_VENDOR") {
        refund.pickup.receivedAt = new Date();
        refund.status = "RETURN_RECEIVED";
        refund.inspection.required = true;
        refund.inspection.result = "PENDING";
      }
    }
    if (notes) refund.pickup.notes = notes;

    refund.timeline.push({
      status: refund.status,
      actorRole: req.user.role,
      actorName: req.user.name,
      notes: `Reverse pickup update: ${refund.pickup.status}`,
      timestamp: new Date(),
    });

    await refund.save();

    res.status(200).json({
      success: true,
      message: "Pickup state updated.",
      refund,
    });
  } catch (error) {
    next(error);
  }
};

export const recordRefundInspectionAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { result, notes = "", proofImages = [] } = req.body;

    const refund = await Refund.findById(id).populate("vendor");
    if (!refund) {
      return next(new AppError("Claim not found", 404));
    }

    assertVendorAccessible(req, refund.vendor._id);

    refund.inspection.result = result; // PASSED | FAILED
    refund.inspection.notes = notes;
    refund.inspection.inspectedBy = req.user._id;
    refund.inspection.inspectedAt = new Date();
    if (proofImages.length > 0) refund.inspection.proofImages = proofImages;

    if (result === "PASSED") {
      refund.status = "INSPECTED_PASSED";
      // Ready for financial payout authorization
      refund.staffReview.forwardedToFinance = true;
    } else {
      refund.status = "INSPECTED_FAILED";
    }

    refund.timeline.push({
      status: refund.status,
      actorRole: req.user.role,
      actorName: req.user.name,
      notes: `Physical inspection ${result}. Note: ${notes}`,
      timestamp: new Date(),
    });

    await refund.save();

    res.status(200).json({
      success: true,
      message: `Inspection recorded as ${result}`,
      refund,
    });
  } catch (error) {
    next(error);
  }
};

export const finalizeRefundPayoutAction = async (req, res, next) => {
  try {
    // Strictly Superadmin or authorized finance role
    if (req.user.role !== "superadmin") {
      return next(
        new AppError(
          "Only Superadmin/Finance authority can execute monetary payouts.",
          403
        )
      );
    }

    const { id } = req.params;
    const refund = await Refund.findById(id).populate("order vendor");
    if (!refund) {
      return next(new AppError("Claim not found", 404));
    }

    if (refund.status === "COMPLETED") {
      return next(new AppError("Refund has already been completed.", 400));
    }

    // Execute ledger and wallet refund
    const refundResult = await processOrderRefund({
      order: refund.order,
      items: refund.items,
      refundAmount: refund.amount,
      reason: refund.reason,
      description: refund.description,
      proofImages: refund.proofImages,
      claimType: refund.claimType,
      customerPayoutDetails: refund.customerPayoutDetails,
      reviewedBy: req.user._id,
      idempotencyKey: `PAYOUT-${refund._id}-${Date.now()}`,
    });

    refund.status = "COMPLETED";
    refund.reviewedBy = req.user._id;
    refund.reviewedAt = new Date();
    refund.timeline.push({
      status: "COMPLETED",
      actorRole: "superadmin",
      actorName: req.user.name,
      notes: "Financial payout executed successfully.",
      timestamp: new Date(),
    });

    await refund.save();

    res.status(200).json({
      success: true,
      message: "Refund payout executed and recorded in financial ledger.",
      data: refundResult,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. STAFFADMIN NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

export const getStaffNotificationsAdmin = async (req, res, next) => {
  try {
    const { type, isRead, page = 1, limit = 30 } = req.query;
    const query = { user: req.user._id };

    if (type && type !== "ALL") query.type = type;
    if (isRead !== undefined && isRead !== "ALL") {
      query.isRead = isRead === "true" || isRead === true;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ]);

    res.status(200).json({
      success: true,
      total,
      unreadCount,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
      notifications,
    });
  } catch (error) {
    next(error);
  }
};

export const markStaffNotificationRead = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === "read-all") {
      await Notification.updateMany(
        { user: req.user._id, isRead: false },
        { isRead: true, readAt: new Date() }
      );
      return res.status(200).json({
        success: true,
        message: "All notifications marked as read.",
      });
    }

    const notif = await Notification.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    res.status(200).json({
      success: true,
      notification: notif,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Detailed Customer Profile & Historical Purchase Insights
 * @route   GET /api/admin/customers/:id or /api/admin/staff-operations/customers/:id
 * @access  Private (Admin / Superadmin)
 */
export const getCustomerDetailsAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isSuperAdmin, accessibleIds } = resolveStaffVendorScope(req);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return next(new AppError("Invalid Customer ID", 400));
    }

    const customer = await User.findById(id)
      .select("-password -tokens -__v")
      .lean();

    if (!customer) {
      return next(new AppError("Customer not found", 404));
    }

    // Scope check: Staff admin can only view customers who have placed orders with their assigned vendors
    let scopedVendorFilter = {};
    if (!isSuperAdmin) {
      const validAccessible = (accessibleIds || [])
        .filter((vid) => vid && mongoose.Types.ObjectId.isValid(vid))
        .map((vid) => new mongoose.Types.ObjectId(vid));

      const matchingOrdersCount = await Order.countDocuments({
        customer: customer._id,
        vendor: { $in: validAccessible },
      });

      if (matchingOrdersCount === 0) {
        return next(
          new AppError(
            "Access denied. This customer has no purchase history within your assigned vendor scope.",
            403
          )
        );
      }
      scopedVendorFilter = { vendor: { $in: validAccessible } };
    }

    // Fetch customer's orders within scope
    const orderQuery = {
      customer: customer._id,
      ...scopedVendorFilter,
    };

    const orders = await Order.find(orderQuery)
      .populate("vendor", "businessDetails sellerDetails brandDetails")
      .populate("assignedDeliveryBoy", "fullName phone")
      .sort({ createdAt: -1 })
      .lean();

    // Metrics calculation
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o) => o.orderStatus === "DELIVERED");
    const activeOrders = orders.filter(
      (o) => !["DELIVERED", "CANCELLED", "REJECTED"].includes(o.orderStatus)
    );
    const cancelledOrders = orders.filter((o) =>
      ["CANCELLED", "REJECTED"].includes(o.orderStatus)
    );

    const totalCompletedSpending = completedOrders.reduce(
      (sum, o) => sum + (o.totalAmount || 0),
      0
    );

    const lastPurchaseDate =
      completedOrders.length > 0
        ? completedOrders[0].deliveredAt || completedOrders[0].createdAt
        : orders.length > 0
        ? orders[0].createdAt
        : null;

    // Fetch customer refunds within scope
    const refunds = await Refund.find({
      customer: customer._id,
      ...scopedVendorFilter,
    })
      .populate("order", "orderNumber totalAmount orderStatus")
      .populate("vendor", "businessDetails.businessName")
      .populate("pickup.deliveryBoy", "fullName phone")
      .sort({ createdAt: -1 })
      .lean();

    const maskedRefunds = refunds.map((r) => ({
      ...r,
      customerPayoutDetails: maskCustomerPayoutDetails(r.customerPayoutDetails),
    }));

    const totalRefundedAmount = refunds
      .filter((r) => ["COMPLETED", "APPROVED"].includes(r.status))
      .reduce((sum, r) => sum + (r.amount || r.totalAmount || 0), 0);

    const netSpending = Math.max(0, totalCompletedSpending - totalRefundedAmount);

    // Most purchased products
    const productMap = {};
    for (const ord of orders) {
      if (ord.orderStatus === "CANCELLED" || ord.orderStatus === "REJECTED") continue;
      for (const item of ord.items || []) {
        const pId = item.productId || item.product?.toString() || item.name;
        if (!productMap[pId]) {
          productMap[pId] = {
            productId: item.productId || item.product,
            name: item.name || "Product",
            imageUrl: item.imageUrl || "",
            totalQuantity: 0,
            totalSpent: 0,
            orderCount: 0,
          };
        }
        productMap[pId].totalQuantity += item.quantity || 1;
        productMap[pId].totalSpent += (item.price || 0) * (item.quantity || 1);
        productMap[pId].orderCount += 1;
      }
    }
    const mostPurchasedProducts = Object.values(productMap)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 10);

    // Vendor-wise summary
    const vendorMap = {};
    for (const ord of orders) {
      const vId = (ord.vendor?._id || ord.vendor)?.toString();
      const vName =
        ord.vendor?.businessDetails?.businessName || ord.vendorName || "Store";
      if (!vendorMap[vId]) {
        vendorMap[vId] = {
          vendorId: vId,
          businessName: vName,
          orderCount: 0,
          totalSpent: 0,
          completedCount: 0,
        };
      }
      vendorMap[vId].orderCount += 1;
      if (ord.orderStatus === "DELIVERED") {
        vendorMap[vId].totalSpent += ord.totalAmount || 0;
        vendorMap[vId].completedCount += 1;
      }
    }
    const vendorSpendingSummary = Object.values(vendorMap).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    // Delivery history
    const deliveryPartnerMap = {};
    for (const ord of orders) {
      if (!ord.assignedDeliveryBoy) continue;
      const dId = (ord.assignedDeliveryBoy._id || ord.assignedDeliveryBoy).toString();
      const dName = ord.assignedDeliveryBoy.fullName || "Delivery Partner";
      const dPhone = ord.assignedDeliveryBoy.phone || "";
      if (!deliveryPartnerMap[dId]) {
        deliveryPartnerMap[dId] = {
          deliveryBoyId: dId,
          fullName: dName,
          phone: dPhone,
          deliveriesCount: 0,
          lastDeliveryAt: null,
        };
      }
      deliveryPartnerMap[dId].deliveriesCount += 1;
      if (
        ord.deliveredAt &&
        (!deliveryPartnerMap[dId].lastDeliveryAt ||
          ord.deliveredAt > deliveryPartnerMap[dId].lastDeliveryAt)
      ) {
        deliveryPartnerMap[dId].lastDeliveryAt = ord.deliveredAt;
      }
    }
    const deliveryHistory = Object.values(deliveryPartnerMap).sort(
      (a, b) => b.deliveriesCount - a.deliveriesCount
    );

    // COD settlement history for this customer
    const codOrders = orders.filter((o) => o.paymentMethod === "Cash on delivery");
    const codHistory = codOrders.map((o) => ({
      orderId: o._id,
      orderNumber: o.orderNumber,
      amountDue: o.codDetails?.amountDue || o.totalAmount,
      amountCollected:
        o.codDetails?.amountCollected ??
        (o.codDetails?.status !== "COD_PENDING" ? o.totalAmount : 0),
      status: o.codDetails?.status || "COD_PENDING",
      vendorConfirmed: o.codDetails?.vendorConfirmed || false,
      discrepancy: o.codDetails?.discrepancy || null,
      createdAt: o.createdAt,
    }));

    return res.status(200).json({
      success: true,
      data: {
        customer,
        metrics: {
          totalOrders,
          completedOrders: completedOrders.length,
          activeOrders: activeOrders.length,
          cancelledOrders: cancelledOrders.length,
          totalCompletedSpending,
          totalRefundedAmount,
          netSpending,
          lastPurchaseDate,
        },
        orders,
        mostPurchasedProducts,
        vendorSpendingSummary,
        deliveryHistory,
        codHistory,
        refunds: maskedRefunds,
        searchInterests: [],
      },
    });
  } catch (error) {
    next(error);
  }
};

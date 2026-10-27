import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Category from "../models/Category.js";
import Ticket from "../models/Ticket.js";
import AuditLog from "../models/AuditLog.js";
import PlatformPaymentConfig from "../models/PlatformPaymentConfig.js";
import VendorTransaction from "../models/VendorTransaction.js";
import Refund from "../models/Refund.js";
import Notification from "../models/Notification.js";
import VendorNotification from "../models/VendorNotification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { FINANCE_CONFIG, calculateCommission } from "../config/financeConfig.js";
import { logAdminAction } from "../services/auditService.js";
import { getIO, emitVendorNotification, emitToDeliveryPartner } from "../socket/socketManager.js";
import { sendPushToUsers, sendPushToVendors, sendPushToDeliveryPartners, sendPushToRoles } from "../services/pushNotificationService.js";
import { uploadCategoryImageToCloudinary } from "../utils/cloudinaryUpload.js";

// Helper to build date range from timeframe filter
const getDateRangeFilter = (timeframe, startDate, endDate) => {
  const now = new Date();
  let start = new Date(0);
  let end = now;

  if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }

  switch (timeframe) {
    case "today": {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      break;
    }
    case "yesterday": {
      start = new Date(now);
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setHours(23, 59, 59, 999);
      break;
    }
    case "last7days": {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      break;
    }
    case "last30days": {
      start = new Date(now);
      start.setDate(now.getDate() - 30);
      break;
    }
    case "thisMonth": {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    default:
      return null;
  }

  return { $gte: start, $lte: end };
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. GLOBAL & SCOPED DASHBOARD ANALYTICS
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAdminDashboardStats = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const accessibleVendors = req.accessibleVendorIds; // array of vendor string IDs or null
    const { timeframe, startDate, endDate } = req.query;

    const dateFilter = getDateRangeFilter(timeframe, startDate, endDate);

    // Vendor query filter
    const vendorQuery = {};
    if (!isSuperAdmin && accessibleVendors) {
      vendorQuery._id = { $in: accessibleVendors };
    }

    // Order query filter
    const orderQuery = {};
    if (!isSuperAdmin && accessibleVendors) {
      orderQuery.vendor = { $in: accessibleVendors };
    }
    if (dateFilter) {
      orderQuery.createdAt = dateFilter;
    }

    // Parallel aggregate count lookups
    const [
      totalVendors,
      activeVendors,
      pendingVendors,
      totalCustomers,
      activeCustomers,
      totalDeliveryBoys,
      onlineDeliveryBoys,
      ordersAgg,
      financialAgg,
      openTicketsCount,
      pendingWithdrawalsCount,
    ] = await Promise.all([
      Vendor.countDocuments(vendorQuery),
      Vendor.countDocuments({
        ...vendorQuery,
        $or: [{ status: { $in: ["approved", "active"] } }, { "businessDetails.verificationStatus": "approved" }],
        isStoreOpen: true,
      }),
      Vendor.countDocuments({
        ...vendorQuery,
        $or: [{ status: { $in: ["pending", "draft"] } }, { "businessDetails.verificationStatus": "pending" }],
      }),
      isSuperAdmin ? User.countDocuments({ role: "customer" }) : 0,
      isSuperAdmin ? User.countDocuments({ role: "customer", isActive: true }) : 0,
      isSuperAdmin ? DeliveryBoy.countDocuments({}) : 0,
      isSuperAdmin ? DeliveryBoy.countDocuments({ availability: "ONLINE" }) : 0,
      Order.aggregate([
        { $match: orderQuery },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            completedOrders: {
              $sum: { $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, 1, 0] },
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
                      ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            grossSales: {
              $sum: {
                $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0],
              },
            },
          },
        },
      ]),
      // Financial ledger sums (Only queried if Superadmin)
      isSuperAdmin
        ? VendorTransaction.aggregate([
            {
              $match: dateFilter ? { createdAt: dateFilter } : {},
            },
            {
              $group: {
                _id: null,
                totalCapturedGross: {
                  $sum: { $cond: [{ $in: ["$type", ["ORDER_CREDIT", "COD_ORDER_RECORD"]] }, "$grossAmount", 0] },
                },
                totalCommission: {
                  $sum: { $cond: [{ $in: ["$type", ["ORDER_CREDIT", "COD_ORDER_RECORD"]] }, "$commission", 0] },
                },
                totalCommissionReversals: {
                  $sum: { $cond: [{ $eq: ["$type", "COMMISSION_REVERSAL"] }, "$amount", 0] },
                },
                totalVendorEarnings: {
                  $sum: { $cond: [{ $in: ["$type", ["ORDER_CREDIT", "COD_ORDER_RECORD"]] }, "$netAmount", 0] },
                },
                totalRefundDeductions: {
                  $sum: { $cond: [{ $eq: ["$type", "REFUND_DEDUCTION"] }, "$amount", 0] },
                },
                totalWithdrawalsPaid: {
                  $sum: { $cond: [{ $eq: ["$type", "WITHDRAWAL_PAYOUT"] }, "$amount", 0] },
                },
              },
            },
          ])
        : Promise.resolve([]),
      // Open Support Tickets
      Ticket.countDocuments({
        status: { $in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
        ...(isSuperAdmin ? {} : { vendor: { $in: accessibleVendors || [] } }),
      }),
      // Pending Withdrawals
      isSuperAdmin
        ? VendorTransaction.countDocuments({ type: "WITHDRAWAL_REQUEST", status: "PENDING" })
        : 0,
    ]);

    const orderStats = ordersAgg[0] || {
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      pendingOrders: 0,
      grossSales: 0,
    };

    const finStats = financialAgg[0] || {
      totalCapturedGross: 0,
      totalCommission: 0,
      totalCommissionReversals: 0,
      totalVendorEarnings: 0,
      totalRefundDeductions: 0,
      totalWithdrawalsPaid: 0,
    };

    // Calculate net superadmin commission (Gross Commission - Reversals)
    const netSuperadminCommission = Math.max(
      0,
      Math.round((finStats.totalCommission - finStats.totalCommissionReversals) * 100) / 100
    );

    // Sum current vendor wallet balances
    let totalVendorWalletBalance = 0;
    let totalPendingSettlement = 0;
    if (isSuperAdmin) {
      const walletSums = await Vendor.aggregate([
        {
          $group: {
            _id: null,
            totalAvailable: { $sum: "$wallet.currentBalance" },
            totalPending: { $sum: "$wallet.pendingSettlement" },
          },
        },
      ]);
      if (walletSums[0]) {
        totalVendorWalletBalance = Math.round(walletSums[0].totalAvailable * 100) / 100;
        totalPendingSettlement = Math.round(walletSums[0].totalPending * 100) / 100;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        isSuperAdmin,
        kpi: {
          vendors: {
            total: totalVendors,
            active: activeVendors,
            pendingVerification: pendingVendors,
          },
          customers: {
            total: totalCustomers,
            active: activeCustomers,
          },
          deliveryBoys: {
            total: totalDeliveryBoys,
            online: onlineDeliveryBoys,
          },
          orders: {
            total: orderStats.totalOrders,
            completed: orderStats.completedOrders,
            pending: orderStats.pendingOrders,
            cancelled: orderStats.cancelledOrders,
            grossSales: orderStats.grossSales,
          },
          finances: isSuperAdmin
            ? {
                commissionRate: FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE,
                grossTransactions: finStats.totalCapturedGross,
                netCommissionEarned: netSuperadminCommission,
                vendorGrossEarnings: finStats.totalVendorEarnings,
                vendorWalletBalances: totalVendorWalletBalance,
                vendorPendingSettlements: totalPendingSettlement,
                totalRefundDeductions: finStats.totalRefundDeductions,
                totalWithdrawalsPaid: finStats.totalWithdrawalsPaid,
                pendingWithdrawalsCount,
              }
            : null,
          tickets: {
            open: openTicketsCount,
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Detailed chart series for dashboard
 */
export const getDashboardCharts = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const accessibleVendors = req.accessibleVendorIds;
    const { days = 7 } = req.query;

    const numDays = Math.min(30, Math.max(7, parseInt(days, 10) || 7));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - numDays);
    startDate.setHours(0, 0, 0, 0);

    const matchQuery = {
      createdAt: { $gte: startDate },
      ...(isSuperAdmin ? {} : { vendor: { $in: accessibleVendors || [] } }),
    };

    // Daily Sales & Order Volumes
    const dailyData = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          ordersCount: { $sum: 1 },
          sales: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Payment Method Breakdown
    const paymentBreakdown = await Order.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: "$paymentMethod",
          count: { $sum: 1 },
          amount: { $sum: "$totalAmount" },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        dailyTrends: dailyData,
        paymentBreakdown,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. VENDOR MANAGEMENT & VERIFICATION
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllVendorsAdmin = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const accessibleVendors = req.accessibleVendorIds;
    const { search, status, verification, page = 1, limit = 20 } = req.query;

    const conditions = [];

    if (!isSuperAdmin && accessibleVendors) {
      conditions.push({ _id: { $in: accessibleVendors } });
    }

    if (search) {
      conditions.push({
        $or: [
          { "businessDetails.businessName": { $regex: search, $options: "i" } },
          { "sellerDetails.sellerName": { $regex: search, $options: "i" } },
          { "sellerDetails.sellerPhone": { $regex: search, $options: "i" } },
        ],
      });
    }

    if (status === "open") conditions.push({ isStoreOpen: true });
    if (status === "closed") conditions.push({ isStoreOpen: false });

    if (verification) {
      const vLower = verification.toLowerCase();
      if (vLower === "approved") {
        conditions.push({
          $or: [
            { status: "approved" },
            { status: "active" },
            { "businessDetails.verificationStatus": "approved" },
          ],
        });
      } else if (vLower === "pending") {
        conditions.push({
          $or: [
            { status: "pending" },
            { status: "draft" },
            { "businessDetails.verificationStatus": "pending" },
          ],
        });
      } else if (vLower === "rejected") {
        conditions.push({
          $or: [
            { status: "rejected" },
            { "businessDetails.verificationStatus": "rejected" },
          ],
        });
      }
    }

    const query = conditions.length > 0 ? { $and: conditions } : {};

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [vendors, total] = await Promise.all([
      Vendor.find(query)
        .populate("userId", "name email phone isActive")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Vendor.countDocuments(query),
    ]);

    // Find assigned admin for each vendor
    const vendorIds = vendors.map((v) => v._id);
    const admins = await User.find({
      role: "admin",
      assignedVendors: { $in: vendorIds },
    })
      .select("name email assignedVendors")
      .lean();

    const vendorAdminMap = new Map();
    for (const admin of admins) {
      for (const vId of admin.assignedVendors || []) {
        vendorAdminMap.set(vId.toString(), {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
        });
      }
    }

    const formatted = vendors.map((v) => {
      const rawStatus = (v.status || v.businessDetails?.verificationStatus || "approved").toLowerCase();
      const normalizedStatus = rawStatus === "active" ? "approved" : rawStatus;

      return {
        ...v,
        status: normalizedStatus,
        verificationStatus: normalizedStatus,
        assignedAdmin: vendorAdminMap.get(v._id.toString()) || null,
      };
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

export const getVendorDetailsAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isSuperAdmin = req.user.role === "superadmin";

    if (!isSuperAdmin && req.accessibleVendorIds && !req.accessibleVendorIds.includes(id)) {
      return next(new AppError("You do not have permission to view this vendor", 403));
    }

    const vendor = await Vendor.findById(id).populate("userId", "name email phone isActive createdAt");
    if (!vendor) {
      return next(new AppError("Vendor not found", 404));
    }

    const [
      productsCount,
      activeProductsCount,
      topProducts,
      ordersCount,
      vendorOrders,
      financialAgg,
      withdrawals,
      tickets,
      assignedAdmin,
      allVendorTransactions,
      refundClaims,
    ] = await Promise.all([
      Product.countDocuments({ vendor: vendor._id }),
      Product.countDocuments({ vendor: vendor._id, isActive: true }),
      Product.find({ vendor: vendor._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("name price originalPrice stock images category isActive rating")
        .lean(),
      Order.countDocuments({ vendor: vendor._id }),
      Order.find({ vendor: vendor._id })
        .populate("customer", "name email phone")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Order.aggregate([
        { $match: { vendor: vendor._id } },
        {
          $group: {
            _id: null,
            totalGrossSales: {
              $sum: {
                $cond: [
                  { $in: ["$orderStatus", ["cancelled", "refunded", "CANCELLED", "REFUNDED"]] },
                  0,
                  "$totalAmount",
                ],
              },
            },
            paidSales: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0] },
            },
            pendingSales: {
              $sum: { $cond: [{ $ne: ["$paymentStatus", "paid"] }, "$totalAmount", 0] },
            },
            totalCommission: {
              $sum: {
                $cond: [
                  { $in: ["$orderStatus", ["cancelled", "refunded", "CANCELLED", "REFUNDED"]] },
                  0,
                  { $ifNull: ["$commissionAmount", { $multiply: ["$totalAmount", 0.015] }] },
                ],
              },
            },
            totalVendorNet: {
              $sum: {
                $cond: [
                  { $in: ["$orderStatus", ["cancelled", "refunded", "CANCELLED", "REFUNDED"]] },
                  0,
                  { $ifNull: ["$vendorNetAmount", { $multiply: ["$totalAmount", 0.985] }] },
                ],
              },
            },
            deliveredOrders: {
              $sum: { $cond: [{ $in: ["$orderStatus", ["delivered", "completed", "DELIVERED", "COMPLETED"]] }, 1, 0] },
            },
            cancelledOrders: {
              $sum: { $cond: [{ $in: ["$orderStatus", ["cancelled", "refunded", "CANCELLED", "REFUNDED"]] }, 1, 0] },
            },
          },
        },
      ]),
      VendorTransaction.find({
        vendor: vendor._id,
        type: { $in: ["WITHDRAWAL", "WITHDRAWAL_REQUEST", "WITHDRAWAL_PAYOUT"] },
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      Ticket.find({ vendor: vendor._id })
        .populate("raisedBy", "name email")
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
      User.findOne({ role: "admin", assignedVendors: vendor._id }).select("name email phone").lean(),
      VendorTransaction.find({ vendor: vendor._id })
        .populate("order", "orderNumber totalAmount orderStatus items")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      Refund.find({ vendor: vendor._id })
        .populate("customer", "name email phone")
        .populate("order", "orderNumber totalAmount orderStatus items")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
    ]);

    const fin = financialAgg[0] || {
      totalGrossSales: 0,
      totalCommission: 0,
      totalVendorNet: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
    };

    const pendingWithdrawals = withdrawals.filter((w) => w.status === "PENDING");
    const pendingWithdrawalsAmount = pendingWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const paidWithdrawals = withdrawals.filter((w) => w.status === "COMPLETED");
    const totalWithdrawalsPaid = paidWithdrawals.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    // Format all vendor orders with exact accounting and items
    const formattedOrders = vendorOrders.map((o) => {
      const gross = o.totalAmount || 0;
      const commission =
        o.commissionAmount != null ? o.commissionAmount : Math.round(gross * 0.015 * 100) / 100;
      const vendorNet =
        o.vendorNetAmount != null ? o.vendorNetAmount : Math.round((gross - commission) * 100) / 100;
      return {
        ...o,
        orderStatus: (o.orderStatus || "PLACED").toUpperCase(),
        paymentStatus: (o.paymentStatus || "pending").toLowerCase(),
        commissionAmount: commission,
        vendorNetAmount: vendorNet,
        itemsCount: o.totalCount || (o.items ? o.items.length : 0),
      };
    });

    const uniqueCustomers = new Map();
    formattedOrders.forEach((o) => {
      if (o.customer && o.customer._id) {
        const cId = o.customer._id.toString();
        if (!uniqueCustomers.has(cId)) {
          uniqueCustomers.set(cId, {
            _id: cId,
            name: o.customer.name || "Customer",
            email: o.customer.email || "",
            phone: o.customer.phone || "",
            ordersCount: 1,
            totalSpent: o.totalAmount || 0,
            lastOrderDate: o.createdAt,
          });
        } else {
          const c = uniqueCustomers.get(cId);
          c.ordersCount += 1;
          c.totalSpent += o.totalAmount || 0;
        }
      }
    });

    // Compile product sales transactions made by customers
    const orderTxIds = new Set();
    const productTransactions = [];

    // 1. Transactions directly from VendorTransaction collection
    allVendorTransactions
      .filter((t) => t.type !== "WITHDRAWAL")
      .forEach((t) => {
        if (t.order?._id) orderTxIds.add(t.order._id.toString());
        const gross = t.grossAmount || t.amount || 0;
        const comm = t.commission != null ? t.commission : Math.round(gross * 0.015 * 100) / 100;
        const net = t.netAmount != null ? t.netAmount : Math.round((gross - comm) * 100) / 100;
        productTransactions.push({
          _id: t._id,
          type: t.type || "ORDER_EARNING",
          orderId: t.order?._id || null,
          orderNumber: t.order?.orderNumber || (t.notes ? t.notes.slice(0, 24) : "DIRECT_SALE"),
          customerName: t.order?.customer?.name || "Customer",
          customerPhone: t.order?.customer?.phone || "",
          itemsSummary: t.order?.items ? t.order.items.map((i) => `${i.name} (x${i.quantity})`).join(", ") : "Product order",
          itemsCount: t.order?.items ? t.order.items.length : 1,
          grossAmount: gross,
          commission: comm,
          netAmount: net,
          paymentMethod: t.paymentMethod || "Cash on delivery",
          status: t.status || "SETTLED",
          createdAt: t.createdAt,
        });
      });

    // 2. Synthesize sales ledger from orders if not explicitly present in VendorTransaction
    formattedOrders.forEach((o) => {
      const oId = o._id.toString();
      if (!orderTxIds.has(oId)) {
        const gross = o.totalAmount || 0;
        const comm = o.commissionAmount;
        const net = o.vendorNetAmount;
        const isDelivered = o.orderStatus === "DELIVERED";
        const isCancelled = ["CANCELLED", "REJECTED"].includes(o.orderStatus);
        productTransactions.push({
          _id: `tx-ord-${oId}`,
          type: isCancelled ? "REFUND_DEDUCTION" : "ORDER_EARNING",
          orderId: o._id,
          orderNumber: o.orderNumber,
          customerName: o.customer?.name || "Customer",
          customerPhone: o.customer?.phone || "",
          itemsSummary: (o.items || []).map((i) => `${i.name} (x${i.quantity})`).join(", ") || "Purchased Products",
          itemsCount: o.itemsCount || 1,
          grossAmount: gross,
          commission: comm,
          netAmount: net,
          paymentMethod: o.paymentMethod || "Cash on delivery",
          status: isDelivered ? "SETTLED" : isCancelled ? "REVERSED" : "PENDING",
          createdAt: o.createdAt,
        });
      }
    });

    productTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Compile unified returns, refunds, and replacements records
    const processedOrderClaimIds = new Set();
    const unifiedClaims = [];

    // 1. Claims from Refund model
    refundClaims.forEach((r) => {
      if (r.order?._id) processedOrderClaimIds.add(r.order._id.toString());
      unifiedClaims.push({
        _id: r._id,
        refundNumber: r.refundNumber || `REF-${r._id.toString().slice(-6).toUpperCase()}`,
        claimType: r.claimType || "RETURN_REFUND",
        status: r.status || "REQUESTED",
        amount: r.amount || 0,
        vendorDeduction: r.vendorDeduction || r.amount || 0,
        commissionReversal: r.commissionReversal || Math.round((r.amount || 0) * 0.015 * 100) / 100,
        reason: r.reason || "Customer refund claim",
        description: r.description || "",
        orderNumber: r.orderNumber || r.order?.orderNumber || "N/A",
        customerName: r.customer?.name || "Customer",
        customerPhone: r.customer?.phone || "",
        items: r.items && r.items.length > 0 ? r.items : r.order?.items || [],
        createdAt: r.createdAt,
      });
    });

    // 2. Orders with refund/return/cancellation statuses
    formattedOrders.forEach((o) => {
      const oId = o._id.toString();
      const refStatus = (o.refundStatus || "NONE").toUpperCase();
      const isCancelled = ["CANCELLED", "REJECTED"].includes(o.orderStatus);

      if (!processedOrderClaimIds.has(oId) && (refStatus !== "NONE" || isCancelled)) {
        const isReplace = refStatus === "REPLACED";
        const isReturn = refStatus === "APPROVED" || refStatus === "REQUESTED";
        const claimType = isReplace
          ? "REPLACEMENT"
          : isCancelled
          ? "CANCELLATION"
          : isReturn
          ? "RETURN"
          : "RETURN_REFUND";

        const status =
          refStatus === "REFUNDED" || isCancelled || isReplace
            ? "COMPLETED"
            : refStatus === "APPROVED"
            ? "APPROVED"
            : "REQUESTED";

        unifiedClaims.push({
          _id: `clm-ord-${oId}`,
          refundNumber: `CLM-${(o.orderNumber || oId.slice(-6)).toUpperCase()}`,
          claimType,
          status,
          amount: o.totalAmount || 0,
          vendorDeduction: o.vendorNetAmount || Math.round((o.totalAmount || 0) * 0.985 * 100) / 100,
          commissionReversal: o.commissionAmount || Math.round((o.totalAmount || 0) * 0.015 * 100) / 100,
          reason: o.rejectionReason || "Customer initiated order return / refund",
          description: `Order ${o.orderNumber} flagged as ${claimType}`,
          orderNumber: o.orderNumber,
          customerName: o.customer?.name || "Customer",
          customerPhone: o.customer?.phone || "",
          items: o.items || [],
          createdAt: o.updatedAt || o.createdAt,
        });
      }
    });

    unifiedClaims.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Calculate Claim Breakdown KPIs
    let refundsCount = 0;
    let returnsCount = 0;
    let replacementsCount = 0;
    let pendingClaimsCount = 0;
    let completedClaimsCount = 0;
    let totalRefundAmount = 0;

    unifiedClaims.forEach((c) => {
      const ct = (c.claimType || "").toUpperCase();
      const st = (c.status || "").toUpperCase();

      if (ct.includes("REFUND") || ct.includes("CANCEL")) refundsCount += 1;
      if (ct.includes("RETURN") || ct.includes("DEFECT") || ct.includes("WRONG")) returnsCount += 1;
      if (ct.includes("REPLACE")) replacementsCount += 1;

      if (["REQUESTED", "PROCESSING"].includes(st)) pendingClaimsCount += 1;
      if (["COMPLETED", "APPROVED"].includes(st)) {
        completedClaimsCount += 1;
        totalRefundAmount += c.amount || 0;
      }
    });

    const openTicketsCount = tickets.filter((t) => ["OPEN", "ASSIGNED", "IN_PROGRESS"].includes(t.status)).length;
    let riskLevel = "LOW";
    let riskReason = "Store operations healthy. No open complaints or dispute risks.";
    if (openTicketsCount >= 3 || fin.cancelledOrders >= 5 || pendingClaimsCount >= 3) {
      riskLevel = "HIGH";
      riskReason = `${openTicketsCount} open tickets, ${fin.cancelledOrders} cancellations, and ${pendingClaimsCount} pending claims flagged.`;
    } else if (openTicketsCount > 0 || fin.cancelledOrders > 0 || pendingClaimsCount > 0) {
      riskLevel = "MEDIUM";
      riskReason = `${openTicketsCount} active ticket(s) or ${pendingClaimsCount} return/refund claim(s) under review.`;
    }

    const rawStatus = (vendor.status || vendor.businessDetails?.verificationStatus || "approved").toLowerCase();
    const normalizedStatus = rawStatus === "active" ? "approved" : rawStatus;

    const vendorDoc = {
      ...vendor.toObject(),
      status: normalizedStatus,
      verificationStatus: normalizedStatus,
      wallet: vendor.wallet || {
        currentBalance: 0,
        totalEarned: Math.round(fin.totalVendorNet * 100) / 100,
        pendingSettlement: 0,
        codCashWithDeliveryBoys: 0,
      },
    };

    res.status(200).json({
      success: true,
      data: {
        vendor: vendorDoc,
        stats: {
          productsCount,
          activeProductsCount,
          ordersCount,
          deliveredOrders: fin.deliveredOrders,
          cancelledOrders: fin.cancelledOrders,
          uniqueCustomersCount: uniqueCustomers.size,
        },
        financials: {
          totalGrossSales: Math.round(fin.totalGrossSales * 100) / 100,
          totalCommissionPaid: Math.round(fin.totalCommission * 100) / 100,
          netEarnings: Math.round(fin.totalVendorNet * 100) / 100,
          currentWalletBalance: vendor.wallet?.currentBalance || 0,
          pendingWithdrawalsCount: pendingWithdrawals.length,
          pendingWithdrawalsAmount: Math.round(pendingWithdrawalsAmount * 100) / 100,
          totalWithdrawalsPaid: Math.round(totalWithdrawalsPaid * 100) / 100,
        },
        customers: Array.from(uniqueCustomers.values()),
        orders: formattedOrders,
        recentOrders: formattedOrders.slice(0, 15),
        productTransactions,
        claims: {
          totalClaims: unifiedClaims.length,
          refundsCount,
          returnsCount,
          replacementsCount,
          pendingClaimsCount,
          completedClaimsCount,
          totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
          list: unifiedClaims,
        },
        products: topProducts,
        withdrawals,
        tickets: {
          list: tickets,
          openTicketsCount,
          riskLevel,
          riskReason,
        },
        assignedAdmin: assignedAdmin || null,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateVendorVerificationAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { verificationStatus, reason } = req.body;

    if (!["approved", "rejected", "pending"].includes(verificationStatus)) {
      return next(new AppError("Invalid verification status. Must be approved, rejected, or pending", 400));
    }

    const vendor = await Vendor.findById(id);
    if (!vendor) {
      return next(new AppError("Vendor not found", 404));
    }

    const previousStatus = vendor.status || vendor.businessDetails?.verificationStatus;
    vendor.status = verificationStatus;
    if (!vendor.businessDetails) vendor.businessDetails = {};
    vendor.businessDetails.verificationStatus = verificationStatus;
    if (verificationStatus === "approved") {
      vendor.isStoreOpen = true;
    }
    await vendor.save();

    await logAdminAction({
      req,
      action: "UPDATE_VENDOR_VERIFICATION",
      targetResource: "Vendor",
      targetId: vendor._id,
      changes: { previous: previousStatus, current: verificationStatus, reason },
      details: `Vendor ${vendor.businessDetails?.businessName} verification changed to ${verificationStatus}`,
    });

    res.status(200).json({
      success: true,
      message: `Vendor verification updated to ${verificationStatus}`,
      data: vendor,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. ADMIN MANAGEMENT & VENDOR ASSIGNMENT (SUPERADMIN ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({ role: "admin" })
      .populate("assignedVendors", "businessDetails.businessName brandDetails.brandLogo sellerDetails.sellerName isStoreOpen")
      .select("name email phone role isActive adminPermissions assignedVendors createdAt lastLoginAt")
      .sort({ createdAt: -1 })
      .lean();

    // Query open tickets count for each admin
    const adminIds = admins.map((a) => a._id);
    const ticketCounts = await Ticket.aggregate([
      { $match: { assignedAdmin: { $in: adminIds }, status: { $in: ["OPEN", "IN_PROGRESS", "ASSIGNED"] } } },
      { $group: { _id: "$assignedAdmin", count: { $sum: 1 } } },
    ]);

    const countMap = new Map();
    ticketCounts.forEach((c) => countMap.set(c._id.toString(), c.count));

    const formatted = admins.map((a) => ({
      ...a,
      openTickets: countMap.get(a._id.toString()) || 0,
      assignedVendorsCount: a.assignedVendors?.length || 0,
    }));

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

export const createAdminAccount = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      assignedVendors = [],
      adminPermissions = {},
    } = req.body;

    if (!name || !email || !password) {
      return next(new AppError("Name, email, and password are required to create an admin account", 400));
    }

    if (password.length < 6) {
      return next(new AppError("Password must be at least 6 characters long", 400));
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return next(new AppError("A user with this email address already exists", 409));
    }

    const admin = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone || "",
      role: "admin",
      assignedVendors,
      adminPermissions: {
        canManageVendors: adminPermissions.canManageVendors !== false,
        canEditProducts: adminPermissions.canEditProducts !== false,
        canManageTickets: adminPermissions.canManageTickets !== false,
        canViewOrders: adminPermissions.canViewOrders !== false,
        canSendNotifications: adminPermissions.canSendNotifications !== false,
        canViewAnalytics: adminPermissions.canViewAnalytics !== false,
      },
      isActive: true,
      isEmailVerified: true,
    });

    await logAdminAction({
      req,
      action: "CREATE_ADMIN",
      targetResource: "User",
      targetId: admin._id,
      details: `Created admin account for ${admin.name} (${admin.email}) with ${assignedVendors.length} assigned vendors.`,
    });

    res.status(201).json({
      success: true,
      message: `Admin account for ${admin.name} created successfully.`,
      data: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        assignedVendors: admin.assignedVendors,
        adminPermissions: admin.adminPermissions,
        createdAt: admin.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminAccount = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, phone, assignedVendors, adminPermissions, isActive, newPassword } = req.body;

    const admin = await User.findOne({ _id: id, role: "admin" });
    if (!admin) {
      return next(new AppError("Admin account not found", 404));
    }

    if (name) admin.name = name.trim();
    if (phone !== undefined) admin.phone = phone;
    if (Array.isArray(assignedVendors)) admin.assignedVendors = assignedVendors;
    if (adminPermissions) admin.adminPermissions = { ...admin.adminPermissions, ...adminPermissions };
    if (isActive !== undefined) admin.isActive = Boolean(isActive);
    if (newPassword && newPassword.length >= 6) {
      admin.password = newPassword;
    }

    await admin.save();

    await logAdminAction({
      req,
      action: "UPDATE_ADMIN",
      targetResource: "User",
      targetId: admin._id,
      details: `Updated admin ${admin.name} settings and vendor assignments`,
    });

    res.status(200).json({
      success: true,
      message: "Admin account updated successfully",
      data: admin,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. CUSTOMER MANAGEMENT & SHOPPING ANALYTICS
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllCustomersAdmin = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;

    const query = { role: { $in: ["customer", "user"] } };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [customers, total] = await Promise.all([
      User.find(query)
        .select("name email phone role isActive createdAt lastLoginAt rewardPoints")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    // Aggregate shopping totals for listed customers
    const customerIds = customers.map((c) => c._id);
    const orderSums = await Order.aggregate([
      { $match: { customer: { $in: customerIds } } },
      {
        $group: {
          _id: "$customer",
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$orderStatus", "DELIVERED"] }, 1, 0] },
          },
          totalSpend: {
            $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$totalAmount", 0] },
          },
        },
      },
    ]);

    const orderMap = new Map();
    orderSums.forEach((s) => orderMap.set(s._id.toString(), s));

    const formatted = customers.map((c) => {
      const stats = orderMap.get(c._id.toString()) || {
        totalOrders: 0,
        completedOrders: 0,
        totalSpend: 0,
      };
      return {
        ...c,
        totalOrders: stats.totalOrders,
        completedOrders: stats.completedOrders,
        totalSpend: stats.totalSpend,
      };
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: formatted,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 5. DELIVERY PARTNER MONITORING
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllDeliveryBoysAdmin = async (req, res, next) => {
  try {
    const { availability, status, search } = req.query;

    const query = {};
    if (availability) query.availability = availability;
    if (status) query.approvalStatus = status;
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      query.$or = [
        { fullName: searchRegex },
        { phone: searchRegex },
        { "vehicleDetails.registrationNumber": searchRegex },
      ];
    }

    const deliveryBoys = await DeliveryBoy.find(query)
      .populate("user", "name email phone isActive")
      .populate("activeOrderId", "orderNumber totalAmount orderStatus")
      .sort({ updatedAt: -1 })
      .lean();

    const formattedRiders = deliveryBoys.map((db) => {
      const isOnline = db.availability === "ONLINE" || db.availability === "BUSY";
      const isBusy = db.availability === "BUSY" || Boolean(db.activeOrderId);
      return {
        ...db,
        name: db.fullName || db.user?.name || "Delivery Partner",
        phone: db.phone || db.user?.phone || "",
        isOnline,
        isBusy,
        cashInHand: db.codCashInCustody || 0,
        vehicleNumber: db.vehicleDetails?.registrationNumber || db.vehicleDetails?.vehicleType || "Not assigned",
        completedDeliveries: db.metrics?.totalDeliveries || 0,
        location: db.currentLocation || { coordinates: [0, 0] },
      };
    });

    res.status(200).json({
      success: true,
      count: formattedRiders.length,
      data: formattedRiders,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 6. CATALOG (CATEGORIES, SUBCATEGORIES & PRODUCT MODERATION)
 * ─────────────────────────────────────────────────────────────────────────────
 */
const CUSTOMER_SECTIONS = [
  {
    name: "Grocery & Kitchen",
    slug: "grocery-kitchen",
    image: "https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&q=80",
    description: "Daily fresh essentials, staples, dairy & kitchenware",
    items: [
      { name: "Vegetables & Fruits", slug: "vegetables-fruits", image: "https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=300&q=80" },
      { name: "Atta, Rice & Dal", slug: "atta-rice-dal", image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=80" },
      { name: "Oil, Ghee & Masala", slug: "oil-ghee-masala", image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=300&q=80" },
      { name: "Dairy, Bread & Eggs", slug: "dairy-bread-eggs", image: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=300&q=80" },
      { name: "Bakery & Biscuits", slug: "bakery-biscuits", image: "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=300&q=80" },
      { name: "Dry Fruits & Cereals", slug: "dry-fruits-cereals", image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
      { name: "Chicken, Meat & Fish", slug: "chicken-meat-fish", image: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=300&q=80" },
      { name: "Kitchenware & Appliances", slug: "kitchenware-appliances", image: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=300&q=80" },
    ],
  },
  {
    name: "Snacks & Drinks",
    slug: "snacks-drinks",
    image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=400&q=80",
    description: "Crispy snacks, beverages, chocolates & quick bites",
    items: [
      { name: "Chips, Nachos & Popcorn", slug: "chips-nachos-popcorn", image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=300&q=80" },
      { name: "Namkeen & Roasted Snacks", slug: "namkeen-roasted-snacks", image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=300&q=80" },
      { name: "Biscuits & Cookies", slug: "biscuits-cookies-wafers", image: "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=300&q=80" },
      { name: "Chocolates & Candies", slug: "chocolates-candies-toffees", image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=300&q=80" },
      { name: "Dry Fruits & Nuts", slug: "dryfruits-nuts-seeds", image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
      { name: "Snack Bars & Healthy Bites", slug: "snackbars-healthy-bites", image: "https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?w=300&q=80" },
      { name: "Instant Noodles & Pasta", slug: "instant-noodles-pasta", image: "https://images.unsplash.com/photo-1612927601601-6638404737ce?w=300&q=80" },
      { name: "Cold Drinks & Ice Cream", slug: "cold-drinks-icecream", image: "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=300&q=80" },
    ],
  },
  {
    name: "Beauty & Personal Care",
    slug: "beauty-personal-care",
    image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=400&q=80",
    description: "Skincare, haircare, bath, wellness & cosmetics",
    items: [
      { name: "Bath & Body", slug: "bath-body", image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=300&q=80" },
      { name: "Hair Care", slug: "hair", image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=300&q=80" },
      { name: "Skin & Faces", slug: "skin-faces", image: "https://images.unsplash.com/photo-1556228722-d0b5ed7cd88c?w=300&q=80" },
      { name: "Beauty & Cosmetics", slug: "beauty-cosmetics", image: "https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=300&q=80" },
      { name: "Feminine Hygiene", slug: "feminine-hygiene", image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
      { name: "Fragrances & Deodorants", slug: "fragrances-deodorants", image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?w=300&q=80" },
      { name: "Health & Pharma", slug: "health-pharma", image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
      { name: "Sexual Wellness", slug: "sexual-wellness", image: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&q=80" },
    ],
  },
  {
    name: "Baby",
    slug: "baby",
    image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=400&q=80",
    description: "Diapers, baby food, care & accessories",
    items: [
      { name: "Baby Food", slug: "baby-food", image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=300&q=80" },
      { name: "Diapers & Pants", slug: "diapers-pants", image: "https://images.unsplash.com/photo-1584820927498-cfe5211fd8bf?w=300&q=80" },
      { name: "Baby Care", slug: "baby-care", image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=300&q=80" },
      { name: "Baby Bath", slug: "baby-bath", image: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80" },
      { name: "Baby Feeding", slug: "baby-feeding", image: "https://images.unsplash.com/photo-1596461404969-9ae70f2830c1?w=300&q=80" },
      { name: "Baby Clothing", slug: "baby-clothing", image: "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=300&q=80" },
      { name: "Baby Accessories", slug: "baby-accessories", image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=300&q=80" },
    ],
  },
  {
    name: "School, Office & Stationery",
    slug: "school-office-stationery",
    image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=400&q=80",
    description: "Pens, notebooks, desk supplies, art & crafts",
    items: [
      { name: "Pens & Pencils", slug: "pens-pencils", image: "https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=300&q=80" },
      { name: "Notebooks & Diaries", slug: "notebooks-diaries", image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=300&q=80" },
      { name: "Markers & Highlighters", slug: "markers-highlighters", image: "https://images.unsplash.com/photo-1585336261026-7fcfbdfa95b8?w=300&q=80" },
      { name: "Geometry & Scales", slug: "geometry-scales", image: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=300&q=80" },
      { name: "Art & Craft Supplies", slug: "art-craft-supplies", image: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=300&q=80" },
      { name: "Files & Folders", slug: "files-folders", image: "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=300&q=80" },
      { name: "Office & Desk Supplies", slug: "office-desk-supplies", image: "https://images.unsplash.com/photo-1507842229451-79b1be886a20?w=300&q=80" },
      { name: "Printer Paper & Labels", slug: "printer-paper-labels", image: "https://images.unsplash.com/photo-1586075010923-2dd4570fb338?w=300&q=80" },
    ],
  },
  {
    name: "Gifting",
    slug: "gifting",
    image: "https://images.unsplash.com/photo-1513885535751-8b9238bd345a?w=400&q=80",
    description: "Sweets, apparel, gadgets, hampers & toys",
    items: [
      { name: "Chocolates & Sweets", slug: "chocolates-sweets", image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=300&q=80" },
      { name: "Men's Wear", slug: "mens-wear", image: "https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=300&q=80" },
      { name: "Women's Wear", slug: "womens-wear", image: "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=300&q=80" },
      { name: "Dresses & Ethnic", slug: "dresses-ethnic", image: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300&q=80" },
      { name: "Cosmetics & Hampers", slug: "cosmetics-hampers", image: "https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=300&q=80" },
      { name: "Electronics & Gadgets", slug: "electronics-gadgets", image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=300&q=80" },
      { name: "Toys & Games", slug: "toys-games", image: "https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=300&q=80" },
      { name: "Kids & Baby Gifts", slug: "kids-baby-gifts", image: "https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=300&q=80" },
    ],
  },
];

const ensureCustomerCategoriesBootstrapped = async () => {
  for (let i = 0; i < CUSTOMER_SECTIONS.length; i++) {
    const sec = CUSTOMER_SECTIONS[i];
    let root = await Category.findOne({ slug: sec.slug });
    if (!root) {
      root = await Category.create({
        name: sec.name,
        slug: sec.slug,
        description: sec.description,
        image: sec.image,
        level: 0,
        displayOrder: i + 1,
        isActive: true,
      });
    }

    for (let j = 0; j < sec.items.length; j++) {
      const it = sec.items[j];
      const existingSub = await Category.findOne({ slug: it.slug, parentCategory: root._id });
      if (!existingSub) {
        await Category.create({
          name: it.name,
          slug: it.slug,
          image: it.image,
          parentCategory: root._id,
          level: 1,
          displayOrder: j + 1,
          isActive: true,
        });
      }
    }
  }
};

export const getCategoriesAdmin = async (req, res, next) => {
  try {
    const rootCount = await Category.countDocuments({ level: 0 });
    if (rootCount < CUSTOMER_SECTIONS.length) {
      await ensureCustomerCategoriesBootstrapped().catch(() => {});
    }

    const categories = await Category.find()
      .populate("parentCategory", "name slug")
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean();

    // Group into root and subcategories
    const rootCategories = categories.filter((c) => c.level === 0 || !c.parentCategory);
    const subCategories = categories.filter((c) => c.level === 1 && c.parentCategory);

    res.status(200).json({
      success: true,
      data: {
        all: categories,
        root: rootCategories,
        subs: subCategories,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createCategoryAdmin = async (req, res, next) => {
  try {
    const { name, slug, description, image, parentCategory, displayOrder, isActive } = req.body;

    if (!name || !name.trim()) {
      return next(new AppError("Category name is required", 400));
    }
    if (!description || !description.trim()) {
      return next(new AppError("Category description is required", 400));
    }
    if (!image || !image.trim()) {
      return next(new AppError("Category image URL is required", 400));
    }

    const genSlug = slug
      ? slug.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
      : name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");

    const level = parentCategory ? 1 : 0;

    let parentId = null;
    if (parentCategory) {
      if (mongoose.Types.ObjectId.isValid(parentCategory)) {
        parentId = parentCategory;
      } else {
        const cleanParent = parentCategory.replace(/^cust-root-/, "");
        const parentDoc = await Category.findOne({ $or: [{ slug: cleanParent }, { name: cleanParent }] });
        if (parentDoc) parentId = parentDoc._id;
      }
    }

    const category = await Category.create({
      name: name.trim(),
      slug: genSlug,
      description: description.trim(),
      image: image.trim(),
      parentCategory: parentId,
      level,
      displayOrder: parseInt(displayOrder, 10) || 0,
      isActive: isActive !== false,
    });

    await logAdminAction({
      req,
      action: "CREATE_CATEGORY",
      targetResource: "Category",
      targetId: category._id,
      details: `Created category ${category.name} (${level === 0 ? "Root" : "Subcategory"})`,
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCategoryAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, slug, description, image, isActive, displayOrder } = req.body;

    let category = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      category = await Category.findById(id);
    }
    if (!category) {
      const cleanSlug = id.replace(/^cust-root-|^cust-sub-/, "");
      category = await Category.findOne({ $or: [{ slug: cleanSlug }, { slug: id }, { name: id }] });
    }

    if (!category) {
      const cleanSlug = id.replace(/^cust-root-|^cust-sub-/, "");
      const newLevel = id.includes("sub") ? 1 : 0;
      category = await Category.create({
        name: name || cleanSlug,
        slug: slug || cleanSlug,
        description: description || "Category Description",
        image: image || "",
        level: newLevel,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      });
    }

    if (name !== undefined) {
      if (!name.trim()) return next(new AppError("Category name cannot be empty", 400));
      category.name = name.trim();
    }
    if (slug !== undefined && slug.trim()) {
      category.slug = slug.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
    }
    if (description !== undefined) {
      if (!description.trim() && isActive !== undefined && !name) {
        // Active toggle only
      } else if (!description.trim()) {
        return next(new AppError("Category description cannot be empty", 400));
      } else {
        category.description = description.trim();
      }
    }
    if (image !== undefined) {
      if (!image.trim() && isActive !== undefined && !name) {
        // Active toggle only
      } else if (!image.trim()) {
        return next(new AppError("Category image URL cannot be empty", 400));
      } else {
        category.image = image.trim();
      }
    }
    if (isActive !== undefined) {
      category.isActive = Boolean(isActive);
    }
    if (displayOrder !== undefined) category.displayOrder = parseInt(displayOrder, 10) || 0;

    await category.save();

    await logAdminAction({
      req,
      action: "UPDATE_CATEGORY",
      targetResource: "Category",
      targetId: category._id,
      details: `Updated category ${category.name} (Active: ${category.isActive})`,
    });

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const uploadCategoryImageAdmin = async (req, res, next) => {
  try {
    let fileSource = null;

    if (req.file && req.file.buffer) {
      fileSource = req.file.buffer;
    } else if (req.body && (req.body.imageBase64 || req.body.image)) {
      fileSource = req.body.imageBase64 || req.body.image;
    }

    if (!fileSource) {
      return next(new AppError("No image file or data provided for upload", 400));
    }

    const uploaded = await uploadCategoryImageToCloudinary(fileSource);

    return res.status(200).json({
      success: true,
      message: "Category image uploaded to Cloudinary successfully",
      data: {
        url: uploaded.url,
        publicId: uploaded.publicId,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAllProductsAdmin = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const accessibleVendors = req.accessibleVendorIds;
    const { search, category, vendorId, page = 1, limit = 20 } = req.query;

    const query = {};
    if (!isSuperAdmin && accessibleVendors) {
      query.vendor = { $in: accessibleVendors };
    } else if (vendorId) {
      query.vendor = vendorId;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { brand: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.category = category;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("vendor", "businessDetails.businessName storeName name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: products.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};

export const getProductDetailsAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    let product = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      product = await Product.findById(id)
        .populate("vendor", "businessDetails sellerDetails brandDetails status storeName")
        .populate("brandRef", "name logo categories status")
        .lean();
    }
    if (!product) {
      product = await Product.findOne({ slug: id })
        .populate("vendor", "businessDetails sellerDetails brandDetails status storeName")
        .populate("brandRef", "name logo categories status")
        .lean();
    }

    if (!product) {
      return next(new AppError("Product not found", 404));
    }

    // Check scope if admin
    if (req.user.role !== "superadmin" && req.accessibleVendorIds) {
      if (!req.accessibleVendorIds.includes(product.vendor?._id?.toString())) {
        return next(new AppError("Unauthorized to view this vendor's product", 403));
      }
    }

    // Compute purchase/order count from orders if 0
    if (!product.ordersCount) {
      const orderCount = await Order.countDocuments({
        "items.product": product._id,
        orderStatus: { $ne: "Cancelled" },
      });
      product.ordersCount = orderCount;
    }

    res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

export const moderateProductAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, price, stock, category, subCategory, isActive } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return next(new AppError("Product not found", 404));
    }

    // Check scope if admin
    if (req.user.role !== "superadmin" && req.accessibleVendorIds) {
      if (!req.accessibleVendorIds.includes(product.vendor?.toString())) {
        return next(new AppError("Unauthorized to moderate products for this vendor", 403));
      }
    }

    if (name) product.name = name.trim();
    if (price !== undefined) product.price = Number(price);
    if (stock !== undefined) product.stock = Number(stock);
    if (category) product.category = category;
    if (subCategory !== undefined) product.subCategory = subCategory;
    if (isActive !== undefined) {
      product.isActive = Boolean(isActive);
      product.status = isActive ? "Active" : "Not Active";
    }

    await product.save();

    await logAdminAction({
      req,
      action: "MODERATE_PRODUCT",
      targetResource: "Product",
      targetId: product._id,
      details: `Moderated product ${product.name} (Stock: ${product.stock}, Price: ${product.price})`,
    });

    res.status(200).json({
      success: true,
      message: "Product moderated successfully",
      data: product,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 7. COMPLETE FINANCIAL MANAGEMENT (SUPERADMIN ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllFinancialTransactions = async (req, res, next) => {
  try {
    const { vendorId, type, page = 1, limit = 25 } = req.query;

    const query = {};
    if (vendorId) query.vendor = vendorId;
    if (type) query.type = type;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      VendorTransaction.find(query)
        .populate("vendor", "businessDetails.businessName")
        .populate("order", "orderNumber totalAmount paymentMethod")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VendorTransaction.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllWithdrawalsAdmin = async (req, res, next) => {
  try {
    const { status = "PENDING" } = req.query;

    const query = { type: "WITHDRAWAL_REQUEST" };
    if (status && status !== "ALL") {
      query.status = status;
    }

    const withdrawals = await VendorTransaction.find(query)
      .populate("vendor", "businessDetails.businessName sellerDetails.sellerPhone wallet")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      data: withdrawals,
    });
  } catch (error) {
    next(error);
  }
};

export const reviewWithdrawalAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, payoutReference = "", reason = "" } = req.body; // action: "APPROVE" or "REJECT"

    if (!["APPROVE", "REJECT"].includes(action)) {
      return next(new AppError("Action must be either APPROVE or REJECT", 400));
    }

    const withdrawalTxn = await VendorTransaction.findById(id);
    if (!withdrawalTxn || withdrawalTxn.type !== "WITHDRAWAL_REQUEST") {
      return next(new AppError("Withdrawal request not found", 404));
    }

    if (withdrawalTxn.status !== "PENDING") {
      return next(new AppError(`Withdrawal has already been marked as ${withdrawalTxn.status}`, 400));
    }

    const vendor = await Vendor.findById(withdrawalTxn.vendor);
    if (!vendor) {
      return next(new AppError("Associated vendor not found", 404));
    }

    const amount = withdrawalTxn.amount;

    if (action === "APPROVE") {
      // Mark request approved
      withdrawalTxn.status = "SETTLED";
      withdrawalTxn.notes = `${withdrawalTxn.notes} | Approved by Superadmin. Reference: ${payoutReference || "Bank Transfer"}`;
      await withdrawalTxn.save();

      // Create permanent ledger payout transaction
      await VendorTransaction.create({
        vendor: vendor._id,
        type: "WITHDRAWAL_PAYOUT",
        amount,
        grossAmount: amount,
        commission: 0,
        netAmount: -amount,
        status: "SETTLED",
        notes: `Payout of NPR ${amount} sent to vendor bank/wallet. Ref: ${payoutReference}`,
        idempotencyKey: `PAYOUT-${withdrawalTxn._id}-${Date.now()}`,
      });

      await logAdminAction({
        req,
        action: "APPROVE_WITHDRAWAL",
        targetResource: "Withdrawal",
        targetId: withdrawalTxn._id,
        details: `Approved withdrawal of NPR ${amount} for ${vendor.businessDetails?.businessName}. Ref: ${payoutReference}`,
      });

      emitVendorNotification(vendor._id.toString(), {
        title: "Withdrawal Approved & Paid",
        message: `Your withdrawal request of NPR ${amount} has been successfully approved and transferred. Reference: ${payoutReference}`,
        type: "WALLET_SETTLEMENT",
      });
    } else {
      // REJECT: Refund available balance back to vendor's wallet!
      withdrawalTxn.status = "REVERSED";
      withdrawalTxn.notes = `${withdrawalTxn.notes} | Rejected by Superadmin. Reason: ${reason}`;
      await withdrawalTxn.save();

      // Restore vendor available balance
      vendor.wallet.currentBalance = Math.round(((vendor.wallet.currentBalance || 0) + amount) * 100) / 100;
      await vendor.save();

      await logAdminAction({
        req,
        action: "REJECT_WITHDRAWAL",
        targetResource: "Withdrawal",
        targetId: withdrawalTxn._id,
        details: `Rejected withdrawal of NPR ${amount} for ${vendor.businessDetails?.businessName}. Reason: ${reason}`,
      });

      emitVendorNotification(vendor._id.toString(), {
        title: "Withdrawal Request Declined",
        message: `Your withdrawal request of NPR ${amount} was declined. The funds have been refunded to your wallet. Reason: ${reason}`,
        type: "WALLET_SETTLEMENT",
      });
    }

    res.status(200).json({
      success: true,
      message: `Withdrawal request ${action === "APPROVE" ? "approved" : "declined"} successfully.`,
      data: withdrawalTxn,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 8. PLATFORM PAYMENT ACCOUNT CONFIGURATION (SUPERADMIN ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getPlatformPaymentConfigAdmin = async (req, res, next) => {
  try {
    const config = await PlatformPaymentConfig.getGlobalConfig();
    res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePlatformPaymentConfigAdmin = async (req, res, next) => {
  try {
    const { bankDetails, enabledPaymentMethods, paymentMethods } = req.body;

    const config = await PlatformPaymentConfig.getGlobalConfig();

    if (bankDetails) {
      config.bankDetails = {
        ...(config.bankDetails ? config.bankDetails.toObject() : {}),
        ...bankDetails,
      };
    }

    if (Array.isArray(enabledPaymentMethods)) {
      config.enabledPaymentMethods = enabledPaymentMethods;
    } else if (paymentMethods && typeof paymentMethods === "object") {
      const currentList = config.enabledPaymentMethods ? config.enabledPaymentMethods.toObject() : [];
      const updatedList = currentList.map((m) => {
        if (paymentMethods[m.methodKey]) {
          return {
            ...m,
            isEnabled: paymentMethods[m.methodKey].isEnabled !== undefined ? Boolean(paymentMethods[m.methodKey].isEnabled) : m.isEnabled,
            maxAmount: Number(paymentMethods[m.methodKey].maxOrderAmount || paymentMethods[m.methodKey].maxAmount) || m.maxAmount,
            accountIdentifier: paymentMethods[m.methodKey].accountIdentifier || m.accountIdentifier,
            qrCodeImageUrl: paymentMethods[m.methodKey].qrCodeImageUrl || m.qrCodeImageUrl,
          };
        }
        return m;
      });
      config.enabledPaymentMethods = updatedList;
    }

    config.updatedBy = req.user._id;
    await config.save();

    await logAdminAction({
      req,
      action: "UPDATE_PLATFORM_PAYMENT_CONFIG",
      targetResource: "PlatformPaymentConfig",
      targetId: config._id,
      details: "Updated platform bank account details and active checkout payment methods.",
    });

    res.status(200).json({
      success: true,
      message: "Platform payment configuration updated successfully",
      data: config,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Public/Customer checkout payment methods endpoint
 */
export const getActiveCheckoutPaymentMethods = async (req, res, next) => {
  try {
    const config = await PlatformPaymentConfig.getGlobalConfig();
    const activeMethods = (config.enabledPaymentMethods || []).filter((m) => m.isEnabled);

    res.status(200).json({
      success: true,
      data: {
        paymentMethods: activeMethods,
        bankDetails: config.bankDetails?.isActive ? config.bankDetails : null,
        fullConfig: config,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 9. UNIFIED SUPPORT TICKET MANAGEMENT
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAllTicketsAdmin = async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === "superadmin";
    const accessibleVendors = req.accessibleVendorIds;
    const { status, category, priority, page = 1, limit = 20 } = req.query;

    const query = {};
    if (!isSuperAdmin && accessibleVendors) {
      query.vendor = { $in: accessibleVendors };
    }

    if (status && status !== "ALL") query.status = status;
    if (category) query.category = category;
    if (priority) query.priority = priority;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [tickets, total] = await Promise.all([
      Ticket.find(query)
        .populate("raisedBy", "name email phone role")
        .populate("vendor", "businessDetails.businessName")
        .populate("assignedAdmin", "name email")
        .populate("order", "orderNumber totalAmount")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Ticket.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: tickets.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: tickets,
    });
  } catch (error) {
    next(error);
  }
};

export const getTicketDetailsAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;

    const ticket = await Ticket.findById(id)
      .populate("raisedBy", "name email phone role")
      .populate("vendor", "businessDetails.businessName sellerDetails.sellerPhone")
      .populate("assignedAdmin", "name email")
      .populate("order", "orderNumber totalAmount paymentMethod orderStatus items")
      .populate("messages.sender", "name email role");

    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    res.status(200).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

export const replyToTicketAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message, status } = req.body;

    if (!message || !message.trim()) {
      return next(new AppError("Message content is required", 400));
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return next(new AppError("Support ticket not found", 404));
    }

    ticket.messages.push({
      sender: req.user._id,
      senderRole: req.user.role,
      message: message.trim(),
      createdAt: new Date(),
    });

    if (status && ["IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"].includes(status)) {
      ticket.status = status;
      if (status === "RESOLVED" || status === "CLOSED") {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = req.user._id;
      }
    }

    if (!ticket.assignedAdmin) {
      ticket.assignedAdmin = req.user._id;
    }

    await ticket.save();

    res.status(200).json({
      success: true,
      message: "Reply sent successfully",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 10. TARGETED NOTIFICATION COMPOSER (SUPERADMIN & AUTHORIZED STAFF)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const searchNotificationRecipientsAdmin = async (req, res, next) => {
  try {
    const { role = "customer", q = "" } = req.query;
    const query = String(q).trim();
    const regex = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

    let results = [];

    if (role === "customer" || role === "user") {
      const filter = { role: { $in: ["customer", "user"] } };
      if (regex) {
        filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
      }
      const users = await User.find(filter)
        .select("name phone email role avatar")
        .limit(25)
        .lean();
      results = users.map((u) => ({
        id: u._id.toString(),
        name: u.name || "Customer",
        phone: u.phone || "",
        email: u.email || "",
        role: "customer",
        avatar: u.avatar || "",
      }));
    } else if (role === "vendor") {
      const filter = {};
      if (regex) {
        filter.$or = [
          { "businessDetails.businessName": regex },
          { "sellerDetails.sellerPhone": regex },
          { "sellerDetails.sellerName": regex },
        ];
      }
      const vendors = await Vendor.find(filter)
        .select("businessDetails.businessName brandDetails.brandLogo sellerDetails isStoreOpen")
        .limit(25)
        .lean();
      results = vendors.map((v) => ({
        id: v._id.toString(),
        name: v.businessDetails?.businessName || v.sellerDetails?.sellerName || "Store",
        phone: v.sellerDetails?.sellerPhone || "",
        email: v.sellerDetails?.sellerEmail || "",
        role: "vendor",
        avatar: v.brandDetails?.brandLogo || "",
        isStoreOpen: v.isStoreOpen,
      }));
    } else if (role === "delivery_boy" || role === "delivery") {
      const filter = {};
      if (regex) {
        filter.$or = [{ fullName: regex }, { phone: regex }, { email: regex }];
      }
      const riders = await DeliveryBoy.find(filter)
        .select("fullName phone email profilePhoto availability user")
        .limit(25)
        .lean();
      results = riders.map((r) => ({
        id: r._id.toString(),
        userId: r.user?.toString() || "",
        name: r.fullName || "Delivery Partner",
        phone: r.phone || "",
        email: r.email || "",
        role: "delivery_boy",
        avatar: r.profilePhoto?.url || "",
        availability: r.availability,
      }));
    } else if (role === "admin" || role === "staff") {
      const filter = { role: "admin" };
      if (regex) {
        filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
      }
      const admins = await User.find(filter)
        .select("name phone email role")
        .limit(25)
        .lean();
      results = admins.map((a) => ({
        id: a._id.toString(),
        name: a.name || "Staff Admin",
        phone: a.phone || "",
        email: a.email || "",
        role: "admin",
      }));
    }

    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

export const sendTargetedNotificationAdmin = async (req, res, next) => {
  try {
    const {
      title,
      body,
      targetAudience, // "ALL", "CUSTOMERS", "VENDORS", "DELIVERY_BOYS", "ADMIN_STAFF", "SPECIFIC", or legacy
      targetRole, // "customer" | "vendor" | "delivery_boy" | "admin"
      targetId,
      deepLink = "",
      data = {},
    } = req.body;

    if (!title || !body) {
      return next(new AppError("Notification title and body are required", 400));
    }

    const isSuperAdmin = req.user.role === "superadmin";
    if (!isSuperAdmin) {
      if (req.user.adminPermissions?.canSendNotifications === false) {
        return next(new AppError("You do not have permission to send notifications", 403));
      }
      if (["ALL", "ADMIN_STAFF", "all"].includes(targetAudience)) {
        return next(new AppError("Only Super Admin can broadcast to all users or admin staff", 403));
      }
    }

    const io = getIO();
    let recipientCount = 0;
    const normAudience = (targetAudience || "").toUpperCase();

    const notifData = {
      ...(typeof data === "object" ? data : {}),
      deepLink: deepLink || "",
      sentBy: req.user._id,
      senderRole: req.user.role,
      senderName: req.user.name || "Super Admin",
    };

    const batchInsertNotifications = async (docs) => {
      if (!docs || !docs.length) return;
      const CHUNK = 500;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await Notification.insertMany(docs.slice(i, i + CHUNK), { ordered: false }).catch(() => {});
      }
    };

    const batchInsertVendorNotifications = async (docs) => {
      if (!docs || !docs.length) return;
      const CHUNK = 500;
      for (let i = 0; i < docs.length; i += CHUNK) {
        await VendorNotification.insertMany(docs.slice(i, i + CHUNK), { ordered: false }).catch(() => {});
      }
    };

    // ─────────────────────────────────────────────────────────────
    // CASE 1: EVERYONE / ALL APP USERS ("ALL")
    // ─────────────────────────────────────────────────────────────
    if (normAudience === "ALL" || normAudience === "ALL_USERS") {
      const [customers, vendors, riders, staff] = await Promise.all([
        User.find({ role: { $in: ["customer", "user"] }, isActive: { $ne: false } }).select("_id").lean(),
        Vendor.find({ $or: [{ status: { $in: ["approved", "active"] } }, { "businessDetails.verificationStatus": "approved" }] }).select("_id").lean(),
        DeliveryBoy.find().select("user _id").lean(),
        User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean(),
      ]);

      const customerDocs = customers.map((c) => ({
        user: c._id,
        title: title.trim(),
        message: body.trim(),
        type: "broadcast",
        data: notifData,
        isRead: false,
      }));

      const vendorDocs = vendors.map((v) => ({
        vendor: v._id,
        title: title.trim(),
        message: body.trim(),
        type: "ANNOUNCEMENT",
        data: notifData,
        isRead: false,
      }));

      const riderUserIds = new Set();
      riders.forEach((r) => {
        if (r.user) riderUserIds.add(r.user.toString());
      });
      const riderDocs = Array.from(riderUserIds).map((uId) => ({
        user: uId,
        title: title.trim(),
        message: body.trim(),
        type: "broadcast",
        data: notifData,
        isRead: false,
      }));

      const staffDocs = staff.map((s) => ({
        user: s._id,
        title: title.trim(),
        message: body.trim(),
        type: "staff_alert",
        data: notifData,
        isRead: false,
      }));

      await Promise.all([
        batchInsertNotifications([...customerDocs, ...riderDocs, ...staffDocs]),
        batchInsertVendorNotifications(vendorDocs),
      ]);

      recipientCount = customers.length + vendors.length + riderUserIds.size + staff.length;

      if (io) {
        io.emit("notification:broadcast", { title, body, deepLink, data: notifData });
        io.emit("vendor:notification:broadcast", { title, body, deepLink, data: notifData });
        io.emit("delivery:notification:broadcast", { title, body, deepLink, data: notifData });
        io.to("role:admin").emit("staff:notification", {
          title,
          message: body,
          eventType: "staff_alert",
          data: notifData,
        });
      }

      sendPushToUsers({ userIds: customers.map((c) => c._id), title, body, data: notifData, channelId: "broadcasts" }).catch(() => {});
      sendPushToVendors({ vendorIds: vendors.map((v) => v._id), title, body, data: notifData, channelId: "broadcasts" }).catch(() => {});
      sendPushToDeliveryPartners({ deliveryBoyIds: riders.map((r) => r._id), title, body, data: notifData, channelId: "broadcasts" }).catch(() => {});
      sendPushToUsers({ userIds: staff.map((s) => s._id), title, body, data: notifData, channelId: "alerts" }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────
    // CASE 2: CUSTOMERS ONLY ("CUSTOMERS" / "ALL_CUSTOMERS")
    // ─────────────────────────────────────────────────────────────
    else if (normAudience === "CUSTOMERS" || normAudience === "ALL_CUSTOMERS") {
      const customers = await User.find({ role: { $in: ["customer", "user"] }, isActive: { $ne: false } }).select("_id").lean();
      recipientCount = customers.length;

      const customerDocs = customers.map((c) => ({
        user: c._id,
        title: title.trim(),
        message: body.trim(),
        type: "broadcast",
        data: notifData,
        isRead: false,
      }));
      await batchInsertNotifications(customerDocs);

      if (io) io.emit("notification:broadcast", { title, body, deepLink, data: notifData });
      sendPushToUsers({ userIds: customers.map((c) => c._id), title, body, data: notifData, channelId: "broadcasts" }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────
    // CASE 3: VENDORS ONLY ("VENDORS" / "ALL_VENDORS")
    // ─────────────────────────────────────────────────────────────
    else if (normAudience === "VENDORS" || normAudience === "ALL_VENDORS") {
      const vendors = await Vendor.find().select("_id").lean();
      recipientCount = vendors.length;

      const vendorDocs = vendors.map((v) => ({
        vendor: v._id,
        title: title.trim(),
        message: body.trim(),
        type: "ANNOUNCEMENT",
        data: notifData,
        isRead: false,
      }));
      await batchInsertVendorNotifications(vendorDocs);

      if (io) {
        io.emit("vendor:notification:broadcast", { title, body, deepLink, data: notifData });
        vendors.forEach((v) => {
          emitVendorNotification(v._id.toString(), {
            title,
            message: body,
            type: "ANNOUNCEMENT",
            data: notifData,
          });
        });
      }
      sendPushToVendors({ vendorIds: vendors.map((v) => v._id), title, body, data: notifData, channelId: "broadcasts" }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────
    // CASE 4: DELIVERY BOYS ONLY ("DELIVERY_BOYS" / "ALL_DELIVERY")
    // ─────────────────────────────────────────────────────────────
    else if (
      normAudience === "DELIVERY_BOYS" ||
      normAudience === "ALL_DELIVERY" ||
      normAudience === "ALL_DELIVERY_BOYS"
    ) {
      const riders = await DeliveryBoy.find().select("user _id").lean();
      const riderUserIds = new Set();
      riders.forEach((r) => {
        if (r.user) riderUserIds.add(r.user.toString());
      });

      const riderUsers = await User.find({ role: "delivery_boy", isActive: { $ne: false } }).select("_id").lean();
      riderUsers.forEach((u) => riderUserIds.add(u._id.toString()));

      recipientCount = riderUserIds.size;

      const riderDocs = Array.from(riderUserIds).map((uId) => ({
        user: uId,
        title: title.trim(),
        message: body.trim(),
        type: "broadcast",
        data: notifData,
        isRead: false,
      }));
      await batchInsertNotifications(riderDocs);

      if (io) {
        io.emit("delivery:notification:broadcast", { title, body, deepLink, data: notifData });
        riders.forEach((r) => {
          if (r._id) {
            emitToDeliveryPartner(r._id.toString(), "delivery:notification", { title, message: body, data: notifData }, r.user?.toString());
          }
        });
      }
      sendPushToDeliveryPartners({ deliveryBoyIds: riders.map((r) => r._id), title, body, data: notifData, channelId: "delivery" }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────
    // CASE 5: ADMIN STAFF ONLY ("ADMIN_STAFF" / "ALL_ADMINS")
    // ─────────────────────────────────────────────────────────────
    else if (normAudience === "ADMIN_STAFF" || normAudience === "ALL_ADMIN_STAFF" || normAudience === "ALL_ADMINS") {
      const staff = await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").lean();
      recipientCount = staff.length;

      const staffDocs = staff.map((s) => ({
        user: s._id,
        title: title.trim(),
        message: body.trim(),
        type: "staff_alert",
        data: notifData,
        isRead: false,
      }));
      await batchInsertNotifications(staffDocs);

      if (io) {
        io.to("role:admin").emit("staff:notification", {
          title,
          message: body,
          eventType: "staff_alert",
          data: notifData,
        });
      }
      sendPushToUsers({ userIds: staff.map((s) => s._id), title, body, data: notifData, channelId: "alerts" }).catch(() => {});
    }
    // ─────────────────────────────────────────────────────────────
    // CASE 6: SPECIFIC TARGET ("SPECIFIC" or legacy specific_*)
    // ─────────────────────────────────────────────────────────────
    else if (
      normAudience === "SPECIFIC" ||
      normAudience === "SPECIFIC_USER" ||
      targetAudience === "specific_customer" ||
      targetAudience === "specific_vendor" ||
      targetAudience === "specific_delivery" ||
      targetAudience === "specific_admin"
    ) {
      if (!targetId) {
        return next(new AppError("Target recipient ID is required for specific targeting", 400));
      }

      let resolvedRole = targetRole;
      if (!resolvedRole) {
        if (targetAudience === "specific_customer") resolvedRole = "customer";
        else if (targetAudience === "specific_vendor") resolvedRole = "vendor";
        else if (targetAudience === "specific_delivery") resolvedRole = "delivery_boy";
        else if (targetAudience === "specific_admin") resolvedRole = "admin";
      }

      if (resolvedRole === "vendor") {
        const vendor = await Vendor.findById(targetId);
        if (!vendor) return next(new AppError("Vendor not found", 404));

        await VendorNotification.create({
          vendor: vendor._id,
          title: title.trim(),
          message: body.trim(),
          type: "ANNOUNCEMENT",
          data: notifData,
        });

        if (vendor.userId) {
          await Notification.create({
            user: vendor.userId,
            title: title.trim(),
            message: body.trim(),
            type: "announcement",
            data: notifData,
          }).catch(() => {});
        }

        emitVendorNotification(vendor._id.toString(), {
          title: title.trim(),
          message: body.trim(),
          type: "ANNOUNCEMENT",
          data: notifData,
        });
        recipientCount = 1;
      } else if (resolvedRole === "delivery_boy" || resolvedRole === "delivery") {
        const rider = (await DeliveryBoy.findById(targetId).populate("user")) || (await DeliveryBoy.findOne({ user: targetId }));
        const targetUserId = rider?.user?._id || rider?.user || targetId;

        await Notification.create({
          user: targetUserId,
          title: title.trim(),
          message: body.trim(),
          type: "broadcast",
          data: notifData,
        });

        if (rider?._id) {
          emitToDeliveryPartner(rider._id.toString(), "delivery:notification", { title, message: body, data: notifData }, targetUserId.toString());
        }
        if (io) {
          io.to(`user:${targetUserId.toString()}`).emit("delivery:notification", { title, message: body, data: notifData });
        }
        recipientCount = 1;
      } else if (resolvedRole === "admin" || resolvedRole === "staff") {
        const adminUser = await User.findById(targetId);
        if (!adminUser) return next(new AppError("Staff Admin not found", 404));

        await Notification.create({
          user: adminUser._id,
          title: title.trim(),
          message: body.trim(),
          type: "staff_alert",
          data: notifData,
        });

        if (io) {
          io.to(`user:${adminUser._id.toString()}`).emit("staff:notification", {
            title,
            message: body,
            eventType: "staff_alert",
            data: notifData,
          });
        }
        recipientCount = 1;
      } else {
        // Customer or default User
        const customer = await User.findById(targetId);
        if (!customer) return next(new AppError("Customer not found", 404));

        await Notification.create({
          user: customer._id,
          title: title.trim(),
          message: body.trim(),
          type: "broadcast",
          data: notifData,
        });

        if (io) {
          io.to(`user:${customer._id.toString()}`).emit("notification:direct", {
            title,
            body,
            deepLink,
            data: notifData,
          });
        }
        recipientCount = 1;
      }
    } else {
      return next(new AppError(`Invalid target audience: ${targetAudience}`, 400));
    }

    await logAdminAction({
      req,
      action: "SEND_TARGETED_NOTIFICATION",
      targetResource: "Notification",
      details: `Sent notification '${title}' to audience: ${targetAudience} (${recipientCount} recipients)`,
    });

    res.status(200).json({
      success: true,
      message: `Notification dispatched successfully to ${recipientCount} recipients.`,
      data: {
        title,
        targetAudience,
        recipientCount,
        dispatchedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 11. LIVE OPERATIONAL MAP
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getLiveOperationalMapData = async (req, res, next) => {
  try {
    const [vendors, deliveryBoys] = await Promise.all([
      Vendor.find({
        $or: [{ status: { $in: ["approved", "active"] } }, { "businessDetails.verificationStatus": "approved" }],
      })
        .select("businessDetails.businessName shippingLocations isStoreOpen deliveryRadiusKm sellerDetails.sellerPhone")
        .lean(),
      DeliveryBoy.find({ approvalStatus: "APPROVED" })
        .populate("user", "name phone")
        .select("fullName phone availability currentLocation lastLocationUpdatedAt activeOrderId")
        .lean(),
    ]);

    const formattedVendors = vendors
      .filter((v) => v.shippingLocations?.latitude && v.shippingLocations?.longitude)
      .map((v) => ({
        id: v._id,
        _id: v._id,
        type: "vendor",
        name: v.businessDetails?.businessName || "Store",
        storeName: v.businessDetails?.businessName || "Store",
        phone: v.sellerDetails?.sellerPhone || "",
        latitude: v.shippingLocations.latitude,
        longitude: v.shippingLocations.longitude,
        location: {
          coordinates: [v.shippingLocations.longitude, v.shippingLocations.latitude],
        },
        isOpen: v.isStoreOpen,
        radiusKm: v.deliveryRadiusKm || 5,
      }));

    const formattedRiders = deliveryBoys
      .filter((r) => r.currentLocation?.coordinates?.length === 2)
      .map((r) => ({
        id: r._id,
        _id: r._id,
        type: "delivery_partner",
        name: r.fullName || r.user?.name || "Rider",
        phone: r.phone || r.user?.phone || "",
        latitude: r.currentLocation.coordinates[1],
        longitude: r.currentLocation.coordinates[0],
        location: {
          coordinates: [r.currentLocation.coordinates[0], r.currentLocation.coordinates[1]],
        },
        availability: r.availability,
        isOnline: r.availability !== "OFFLINE",
        isBusy: r.availability === "BUSY",
        lastUpdated: r.lastLocationUpdatedAt,
      }));

    res.status(200).json({
      success: true,
      data: {
        vendors: formattedVendors,
        riders: formattedRiders,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 12. AUDIT TRAIL (SUPERADMIN ONLY)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const getAuditLogsAdmin = async (req, res, next) => {
  try {
    const { action, targetResource, page = 1, limit = 30 } = req.query;

    const query = {};
    if (action) query.action = action;
    if (targetResource) query.targetResource = targetResource;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: logs.length,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
      currentPage: pageNum,
      data: logs,
    });
  } catch (error) {
    next(error);
  }
};

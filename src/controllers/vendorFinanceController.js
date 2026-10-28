import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import VendorTransaction from "../models/VendorTransaction.js";
import CodHandover from "../models/CodHandover.js";
import VendorNotification from "../models/VendorNotification.js";
import { AppError } from "../middleware/errorMiddleware.js";
import {
  emitVendorNotification,
  emitVendorCodUpdate,
  emitVendorWalletUpdate,
} from "../socket/socketManager.js";
import { uploadToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { recordCodCashSubmission } from "../services/financeLedgerService.js";

/**
 * Helper to resolve authenticated vendor profile
 */
const getAuthenticatedVendor = async (userId) => {
  const vendor = await Vendor.findOne({ userId });
  if (!vendor) {
    throw new AppError("Vendor profile not found for authenticated user", 404);
  }
  return vendor;
};

/**
 * @desc    Get complete real-time dashboard statistics for authenticated vendor
 * @route   GET /api/vendor/dashboard/stats
 * @access  Private (Vendor)
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);

    // 1. Order Status Counts
    const [
      totalOrders,
      pendingOrders,
      processingOrders,
      completedOrders,
      cancelledOrders,
      deliveredOrdersTotal,
      recentOrders,
      recentNotifications,
      unreadNotificationsCount,
    ] = await Promise.all([
      Order.countDocuments({ vendor: vendor._id }),
      Order.countDocuments({ vendor: vendor._id, orderStatus: "PLACED" }),
      Order.countDocuments({
        vendor: vendor._id,
        orderStatus: { $in: ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"] },
      }),
      Order.countDocuments({ vendor: vendor._id, orderStatus: "DELIVERED" }),
      Order.countDocuments({
        vendor: vendor._id,
        orderStatus: { $in: ["CANCELLED", "REJECTED"] },
      }),
      // Sum of delivered order amounts
      Order.aggregate([
        { $match: { vendor: vendor._id, orderStatus: "DELIVERED" } },
        { $group: { _id: null, totalSales: { $sum: "$totalAmount" } } },
      ]),
      // 5 most recent orders
      Order.find({ vendor: vendor._id })
        .populate("customer", "name phone email avatar")
        .populate("assignedDeliveryBoy", "fullName phone vehicleDetails metrics")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      // 5 most recent notifications
      VendorNotification.find({ vendor: vendor._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      // Unread count
      VendorNotification.countDocuments({ vendor: vendor._id, isRead: false }),
    ]);

    const totalSales = deliveredOrdersTotal[0]?.totalSales || 0;

    // Financial balances
    const wallet = vendor.wallet || {
      currentBalance: 0,
      totalEarned: 0,
      pendingSettlement: 0,
      codCashWithDeliveryBoys: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        vendorId: vendor._id,
        storeName: vendor.businessDetails?.businessName || req.user.name,
        deliveryRadiusKm: vendor.deliveryRadiusKm || 5,
        isStoreOpen: vendor.isStoreOpen !== false,
        shippingLocations: vendor.shippingLocations || {},
        metrics: {
          totalOrders,
          pendingOrders,
          processingOrders,
          completedOrders,
          cancelledOrders,
          totalSales,
          totalEarned: wallet.totalEarned || totalSales,
          availableWithdrawalBalance: wallet.currentBalance || 0,
          pendingSettlement: wallet.pendingSettlement || 0,
          codCashWithDeliveryBoys: wallet.codCashWithDeliveryBoys || 0,
          pendingRecoveries: wallet.pendingRecoveries || 0,
          platformCommissionRate: 0.015,
          storeRating: 4.9,
        },
        recentOrders,
        recentNotifications,
        unreadNotificationsCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get vendor transactions with filters & wallet breakdown
 * @route   GET /api/vendor/transactions
 * @access  Private (Vendor)
 */
export const getVendorTransactions = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { type, status, page = 1, limit = 50 } = req.query;

    const query = { vendor: vendor._id };
    if (type && type !== "ALL") {
      query.type = type;
    }
    if (status && status !== "ALL") {
      query.status = status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total, aggregateSummary] = await Promise.all([
      VendorTransaction.find(query)
        .populate("order", "orderNumber totalAmount paymentMethod orderStatus")
        .populate("deliveryBoy", "fullName phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VendorTransaction.countDocuments(query),
      VendorTransaction.aggregate([
        { $match: { vendor: vendor._id } },
        {
          $group: {
            _id: "$status",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const wallet = vendor.wallet || {
      currentBalance: 0,
      totalEarned: 0,
      pendingSettlement: 0,
      codCashWithDeliveryBoys: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        wallet: {
          withdrawableBalance: wallet.currentBalance,
          totalEarned: wallet.totalEarned,
          pendingSettlement: wallet.pendingSettlement,
          codCashWithDeliveryBoys: wallet.codCashWithDeliveryBoys,
        },
        transactions,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
        aggregateSummary,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Request withdrawal from eligible wallet balance
 * @route   POST /api/vendor/wallet/withdraw
 * @access  Private (Vendor)
 */
export const requestWithdrawal = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { amount, notes } = req.body;

    const withdrawAmount = Number(amount);
    if (!withdrawAmount || withdrawAmount <= 0) {
      return next(new AppError("Please provide a valid withdrawal amount", 400));
    }

    if (withdrawAmount < 100) {
      return next(new AppError("Minimum withdrawal amount is NPR 100", 400));
    }

    const currentBalance = vendor.wallet?.currentBalance || 0;
    if (withdrawAmount > currentBalance) {
      return next(
        new AppError(
          `Insufficient withdrawable balance. Available: NPR ${currentBalance.toLocaleString()}`,
          400
        )
      );
    }

    // Check bank account details
    if (!vendor.bankDetails?.accountNumber) {
      return next(
        new AppError(
          "Please configure your Bank Details in Store Settings before requesting a payout.",
          400
        )
      );
    }

    const idempotencyKey = `WITHDRAW-${vendor._id}-${Date.now()}`;

    // Create withdrawal transaction
    const transaction = await VendorTransaction.create({
      vendor: vendor._id,
      type: "WITHDRAWAL",
      amount: withdrawAmount,
      grossAmount: withdrawAmount,
      netAmount: withdrawAmount,
      paymentMethod: "Bank Transfer",
      status: "PENDING",
      idempotencyKey,
      notes: notes || `Withdrawal payout to ${vendor.bankDetails.bankName || "Bank"} (A/C: ****${vendor.bankDetails.accountNumber.slice(-4)})`,
    });

    // Update wallet balance
    vendor.wallet.currentBalance -= withdrawAmount;
    vendor.wallet.pendingSettlement = (vendor.wallet.pendingSettlement || 0) + withdrawAmount;
    await vendor.save();

    // Create persistent notification
    const notification = await VendorNotification.create({
      vendor: vendor._id,
      type: "WITHDRAWAL_UPDATE",
      title: "Withdrawal Request Submitted",
      message: `Your withdrawal request of NPR ${withdrawAmount.toLocaleString()} has been queued for daily settlement.`,
      data: {
        transactionId: transaction._id,
        amount: withdrawAmount,
      },
    });

    // Real-time socket notification & balance update
    emitVendorNotification(vendor._id.toString(), notification);
    emitVendorWalletUpdate(vendor._id.toString(), vendor.wallet);

    res.status(200).json({
      success: true,
      message: `Withdrawal request for NPR ${withdrawAmount.toLocaleString()} submitted successfully.`,
      data: {
        transaction,
        remainingBalance: vendor.wallet.currentBalance,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get persistent vendor notifications
 * @route   GET /api/vendor/notifications
 * @access  Private (Vendor)
 */
export const getVendorNotifications = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { type, isRead, page = 1, limit = 50 } = req.query;

    const query = { vendor: vendor._id };
    if (type && type !== "ALL") {
      query.type = type;
    }
    if (isRead !== undefined && isRead !== "all") {
      query.isRead = isRead === "true" || isRead === true;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      VendorNotification.find(query)
        .populate("order", "orderNumber totalAmount orderStatus")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      VendorNotification.countDocuments(query),
      VendorNotification.countDocuments({ vendor: vendor._id, isRead: false }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / limitNum),
          limit: limitNum,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark single notification as read
 * @route   PATCH /api/vendor/notifications/:id/read
 * @access  Private (Vendor)
 */
export const markNotificationRead = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { id } = req.params;

    const notification = await VendorNotification.findOneAndUpdate(
      { _id: id, vendor: vendor._id },
      { $set: { isRead: true, readAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!notification) {
      return next(new AppError("Notification not found", 404));
    }

    const unreadCount = await VendorNotification.countDocuments({
      vendor: vendor._id,
      isRead: false,
    });

    res.status(200).json({
      success: true,
      data: {
        notification,
        unreadCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Mark all notifications as read
 * @route   PATCH /api/vendor/notifications/read-all
 * @access  Private (Vendor)
 */
export const markAllNotificationsRead = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);

    await VendorNotification.updateMany(
      { vendor: vendor._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      unreadCount: 0,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get COD cash due from delivery boys for this vendor store
 * @route   GET /api/vendor/cod/due-by-riders
 * @access  Private (Vendor)
 */
export const getCodDueByRiders = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);

    // Find delivered COD orders with cash collected but not yet submitted
    const unsubmittedOrders = await Order.find({
      vendor: vendor._id,
      paymentMethod: "Cash on delivery",
      orderStatus: "DELIVERED",
      "codDetails.cashCollectedByRider": true,
      "codDetails.cashSubmittedToVendor": false,
    })
      .populate("assignedDeliveryBoy", "fullName phone vehicleDetails profilePhoto codCashInCustody")
      .populate("customer", "name phone")
      .sort({ deliveredAt: -1 })
      .lean();

    // Group by delivery partner
    const riderMap = new Map();
    unsubmittedOrders.forEach((order) => {
      const rider = order.assignedDeliveryBoy;
      if (!rider) return;
      const rId = rider._id.toString();

      if (!riderMap.has(rId)) {
        riderMap.set(rId, {
          deliveryBoy: rider,
          totalDue: 0,
          ordersCount: 0,
          orders: [],
        });
      }

      const group = riderMap.get(rId);
      const amount = order.codDetails?.cashCollectedAmount || order.totalAmount || 0;
      group.totalDue += amount;
      group.ordersCount += 1;
      group.orders.push({
        _id: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        deliveredAt: order.deliveredAt,
        customerName: order.customer?.name || "Customer",
      });
    });

    const ridersDue = Array.from(riderMap.values());

    // Also get recent COD handover receipts
    const recentHandovers = await CodHandover.find({ vendor: vendor._id })
      .populate("deliveryBoy", "fullName phone")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Find COD discrepancy orders for this vendor
    const discrepantOrders = await Order.find({
      vendor: vendor._id,
      paymentMethod: "Cash on delivery",
      "codDetails.discrepancy.hasDiscrepancy": true,
    })
      .populate("assignedDeliveryBoy", "fullName phone")
      .populate("customer", "name phone")
      .sort({ updatedAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        totalCodPendingSubmission: vendor.wallet?.codCashWithDeliveryBoys || 0,
        ridersCount: ridersDue.length,
        ridersDue,
        discrepantOrdersCount: discrepantOrders.length,
        discrepantOrders: discrepantOrders.map((o) => ({
          orderId: o._id,
          orderNumber: o.orderNumber,
          totalAmount: o.totalAmount,
          riderName: o.assignedDeliveryBoy?.fullName || "Unassigned",
          riderPhone: o.assignedDeliveryBoy?.phone || "",
          discrepancy: o.codDetails?.discrepancy,
          status: o.codDetails?.status,
        })),
        recentHandovers,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Confirm delivery partner cash handover at vendor store
 * @route   POST /api/vendor/cod/confirm-handover
 * @access  Private (Vendor)
 */
export const confirmCodHandover = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { deliveryBoyId, amountSubmitted, paymentMode = "CASH", notes } = req.body;

    if (!deliveryBoyId) {
      return next(new AppError("Delivery partner ID is required", 400));
    }

    const submitted = Number(amountSubmitted);
    if (!submitted || submitted <= 0) {
      return next(new AppError("Valid submitted cash amount is required", 400));
    }

    const deliveryBoy = await DeliveryBoy.findById(deliveryBoyId);
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    // Find unsubmitted COD orders for this rider & vendor
    const eligibleOrders = await Order.find({
      vendor: vendor._id,
      assignedDeliveryBoy: deliveryBoy._id,
      paymentMethod: "Cash on delivery",
      orderStatus: "DELIVERED",
      "codDetails.cashCollectedByRider": true,
      "codDetails.cashSubmittedToVendor": false,
    }).sort({ deliveredAt: 1 });

    const totalDue = eligibleOrders.reduce(
      (sum, ord) => sum + (ord.codDetails?.cashCollectedAmount || ord.totalAmount || 0),
      0
    );

    if (totalDue === 0) {
      return next(
        new AppError("No pending Cash on Delivery orders found for this delivery partner.", 400)
      );
    }

    if (submitted > totalDue) {
      return next(
        new AppError(
          `Submitted amount (NPR ${submitted}) cannot exceed total due amount (NPR ${totalDue}).`,
          400
        )
      );
    }

    // Generate unique handover receipt number
    const receiptNumber = await CodHandover.generateReceiptNumber();

    // Delegate custody clearing and ledger updates (no digital wallet debit/credit for COD)
    const handoverResult = await recordCodCashSubmission(vendor, deliveryBoy, {
      amountSubmitted: submitted,
      totalDue,
      eligibleOrders,
      receiptNumber,
      paymentMode,
      notes,
      confirmedBy: req.user._id,
      discrepancyReason: req.body.discrepancyReason || "",
    });

    if (handoverResult.hasShortfall) {
      await notifyStaffAdminsForVendor({
        vendorId: vendor._id,
        eventType: "staff_cod:discrepancy",
        title: "⚠️ COD Handover Shortfall Discrepancy",
        message: `Vendor ${vendor.businessDetails?.businessName || "Store"} reported cash shortfall of NPR ${handoverResult.shortfall} from ${deliveryBoy.fullName}. Receipt #${receiptNumber}.`,
        data: {
          vendorId: vendor._id,
          deliveryBoyId: deliveryBoy._id,
          expectedAmount: totalDue,
          amountSubmitted: submitted,
          shortfall: handoverResult.shortfall,
          receiptNumber,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: handoverResult.hasShortfall
        ? `COD cash handover confirmed with recorded shortfall discrepancy of NPR ${handoverResult.shortfall}.`
        : `COD cash of NPR ${submitted.toLocaleString()} received and confirmed successfully.`,
      data: handoverResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get vendor payment QR code & UPI configuration
 * @route   GET /api/vendor/payment-qr
 * @access  Private (Vendor)
 */
export const getPaymentQrSettings = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);

    res.status(200).json({
      success: true,
      data: vendor.paymentSettings || {
        qrCodeUrl: "",
        upiId: "",
        accountName: "",
        acceptQrPayments: false,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update vendor payment QR settings (UPI ID, enable/disable)
 * @route   PUT /api/vendor/payment-qr
 * @access  Private (Vendor)
 */
export const updatePaymentQrSettings = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);
    const { upiId, accountName, acceptQrPayments, qrCodeUrl } = req.body;

    if (!vendor.paymentSettings) {
      vendor.paymentSettings = {};
    }

    if (upiId !== undefined) vendor.paymentSettings.upiId = upiId.trim();
    if (accountName !== undefined) vendor.paymentSettings.accountName = accountName.trim();
    if (acceptQrPayments !== undefined) vendor.paymentSettings.acceptQrPayments = Boolean(acceptQrPayments);
    if (qrCodeUrl !== undefined) vendor.paymentSettings.qrCodeUrl = qrCodeUrl;

    await vendor.save();

    res.status(200).json({
      success: true,
      message: "Payment QR code details updated successfully.",
      data: vendor.paymentSettings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Upload Vendor Payment QR Code Image
 * @route   POST /api/vendor/payment-qr/upload
 * @access  Private (Vendor)
 */
export const uploadPaymentQrImage = async (req, res, next) => {
  try {
    const vendor = await getAuthenticatedVendor(req.user._id);

    if (!req.file) {
      return next(new AppError("Please select a QR code image to upload", 400));
    }

    if (vendor.paymentSettings?.qrCodePublicId) {
      await deleteFromCloudinary(vendor.paymentSettings.qrCodePublicId).catch(() => {});
    }

    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      "bhansamart/vendor/payment-qrs",
      600,
      600
    );

    if (!vendor.paymentSettings) {
      vendor.paymentSettings = {};
    }

    vendor.paymentSettings.qrCodeUrl = uploadResult.secure_url;
    vendor.paymentSettings.qrCodePublicId = uploadResult.public_id;
    vendor.paymentSettings.acceptQrPayments = true;
    await vendor.save();

    res.status(200).json({
      success: true,
      message: "Payment QR code image uploaded successfully.",
      data: vendor.paymentSettings,
    });
  } catch (error) {
    next(error);
  }
};

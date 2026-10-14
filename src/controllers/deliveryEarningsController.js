import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import Order from "../models/Order.js";
import CodHandover from "../models/CodHandover.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Get delivery earnings summary and transaction history
 * GET /api/delivery/earnings/summary
 */
export const getEarningsSummary = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 7);
    startOfWeek.setHours(0, 0, 0, 0);

    // Aggregate today's earnings
    const todayStats = await DeliveryEarningsLedger.aggregate([
      {
        $match: {
          deliveryBoy: deliveryBoy._id,
          createdAt: { $gte: startOfToday },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalEarnings" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Aggregate weekly earnings
    const weeklyStats = await DeliveryEarningsLedger.aggregate([
      {
        $match: {
          deliveryBoy: deliveryBoy._id,
          createdAt: { $gte: startOfWeek },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$totalEarnings" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Fetch recent earnings ledger transactions
    const transactions = await DeliveryEarningsLedger.find({
      deliveryBoy: deliveryBoy._id,
    })
      .populate("order", "orderNumber orderStatus totalAmount deliveredAt")
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      wallet: {
        currentBalance: deliveryBoy.wallet?.currentBalance || 0,
        totalEarned: deliveryBoy.wallet?.totalEarned || 0,
      },
      codCashInCustody: deliveryBoy.codCashInCustody || 0,
      today: {
        earnings: todayStats[0]?.total || 0,
        deliveriesCount: todayStats[0]?.count || 0,
      },
      week: {
        earnings: weeklyStats[0]?.total || 0,
        deliveriesCount: weeklyStats[0]?.count || 0,
      },
      totalDeliveries: deliveryBoy.metrics?.totalDeliveries || 0,
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get full COD cash custody, vendor-wise breakdown, and return history for Delivery Partner
 * GET /api/delivery/earnings/cod-custody
 */
export const getCodCustodySummary = async (req, res, next) => {
  try {
    const deliveryBoy = await DeliveryBoy.findOne({ user: req.user._id });
    if (!deliveryBoy) {
      return next(new AppError("Delivery partner profile not found", 404));
    }

    // 1. Fetch all delivered COD orders collected by this delivery boy
    const codOrders = await Order.find({
      assignedDeliveryBoy: deliveryBoy._id,
      paymentMethod: { $in: ["Cash on delivery", "COD"] },
      orderStatus: "DELIVERED",
      "codDetails.cashCollectedByRider": true,
    })
      .populate("vendor", "businessDetails sellerDetails shippingLocations")
      .sort({ deliveredAt: -1 })
      .lean();

    // 2. Fetch all official handover receipts for this delivery boy
    const handovers = await CodHandover.find({
      deliveryBoy: deliveryBoy._id,
    })
      .populate("vendor", "businessDetails sellerDetails shippingLocations")
      .populate("orders", "orderNumber totalAmount")
      .sort({ createdAt: -1 })
      .lean();

    // 3. Compute Totals
    let totalCashCollected = 0;
    let totalCashSubmitted = 0;

    handovers.forEach((h) => {
      totalCashSubmitted += h.amountSubmitted || 0;
    });

    // 4. Vendor-wise breakdown
    const vendorMap = new Map();

    codOrders.forEach((ord) => {
      const amount = ord.codDetails?.cashCollectedAmount || ord.totalAmount || 0;
      totalCashCollected += amount;

      const v = ord.vendor;
      if (!v) return;
      const vId = v._id.toString();

      if (!vendorMap.has(vId)) {
        vendorMap.set(vId, {
          vendorId: vId,
          storeName: v.businessDetails?.businessName || "Vendor Store",
          storePhone: v.sellerDetails?.sellerPhone || "",
          storeAddress:
            v.shippingLocations?.warehouseAddress ||
            v.sellerDetails?.address ||
            "",
          city: v.shippingLocations?.city || "",
          totalCollected: 0,
          totalSubmitted: 0,
          pendingHandover: 0,
          pendingOrdersCount: 0,
          submittedOrdersCount: 0,
          orders: [],
        });
      }

      const vData = vendorMap.get(vId);
      vData.totalCollected += amount;

      const isSubmitted = Boolean(ord.codDetails?.cashSubmittedToVendor);
      if (isSubmitted) {
        vData.totalSubmitted += amount;
        vData.submittedOrdersCount += 1;
      } else {
        vData.pendingHandover += amount;
        vData.pendingOrdersCount += 1;
      }

      vData.orders.push({
        _id: ord._id,
        orderNumber: ord.orderNumber,
        amount,
        collectedAt: ord.codDetails?.cashCollectedAt || ord.deliveredAt,
        isSubmitted,
        handoverReceipt: ord.codDetails?.handoverReceipt || "",
      });
    });

    const vendorBreakdown = Array.from(vendorMap.values());

    res.status(200).json({
      success: true,
      data: {
        currentCashInCustody: deliveryBoy.codCashInCustody || 0,
        totalCashCollected,
        totalCashSubmitted,
        vendorBreakdown,
        handovers: handovers.map((h) => ({
          _id: h._id,
          receiptNumber: h.receiptNumber,
          storeName: h.vendor?.businessDetails?.businessName || "Vendor Store",
          storeAddress: h.vendor?.shippingLocations?.warehouseAddress || "",
          amountSubmitted: h.amountSubmitted,
          amountDue: h.amountDue,
          remainingBalance: h.remainingBalance,
          verifiedAt: h.verifiedAt || h.createdAt,
          paymentMode: h.paymentMode,
          notes: h.notes,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

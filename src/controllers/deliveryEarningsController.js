import DeliveryBoy from "../models/DeliveryBoy.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
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

import Order from "../models/Order.js";
import { AppError } from "../middleware/errorMiddleware.js";
import { recordOnlineOrderPayment } from "../services/financeLedgerService.js";
import { emitOrderStatusUpdate } from "../socket/socketManager.js";

/**
 * @desc    Initialize / Create Payment for an order
 * @route   POST /api/payments/initialize
 * @access  Private (Customer)
 */
export const initializePayment = async (req, res, next) => {
  try {
    const { orderId, paymentProvider = "card", returnUrl } = req.body;

    const order = await Order.findOne({
      _id: orderId,
      customer: req.user._id,
    });

    if (!order) {
      return next(new AppError("Order not found or unauthorized", 404));
    }

    if (order.paymentStatus === "paid") {
      return next(new AppError("This order has already been paid for", 400));
    }

    const transactionReference = `TXN-${order.orderNumber}-${Date.now()}`;

    // Payment gateway payload structure
    const paymentSession = {
      orderId: order._id,
      orderNumber: order.orderNumber,
      amount: order.totalAmount,
      currency: "NPR",
      paymentProvider,
      transactionReference,
      customer: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
      returnUrl: returnUrl || `${process.env.CLIENT_URL || "http://localhost:8081"}/Screens/Profile/order-summary?orderId=${order._id}`,
    };

    res.status(200).json({
      success: true,
      message: "Payment initialized successfully",
      data: paymentSession,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify Payment after gateway response
 * @route   POST /api/payments/verify
 * @access  Private (Customer / System)
 */
export const verifyPayment = async (req, res, next) => {
  try {
    const {
      orderId,
      gatewayTransactionId,
      paymentProvider = "Online Payment",
      gatewayStatus = "SUCCESS",
      rawResponse,
    } = req.body;

    if (!orderId) {
      return next(new AppError("Order ID is required for verification", 400));
    }

    const order = await Order.findById(orderId).populate("vendor customer");
    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    if (gatewayStatus !== "SUCCESS" && gatewayStatus !== "COMPLETED") {
      order.paymentStatus = "failed";
      await order.save();
      return next(new AppError("Payment verification failed at gateway", 400));
    }

    // Process financial ledger, 1.5% commission, and credit vendor wallet
    const result = await recordOnlineOrderPayment(order, {
      gatewayTransactionId: gatewayTransactionId || `GTW-${Date.now()}`,
      paymentProvider,
      rawGatewayResponse: rawResponse || null,
    });

    // Notify customer
    emitOrderStatusUpdate(
      order._id.toString(),
      order.customer?._id?.toString() || order.customer?.toString(),
      order
    );

    res.status(200).json({
      success: true,
      message: "Payment verified successfully. Vendor wallet and commission recorded.",
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        financialLedger: order.financialLedger,
        alreadyProcessed: result.alreadyProcessed,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Webhook handler for payment gateway notifications
 * @route   POST /api/payments/webhook
 * @access  Public (Gateway authenticated via secret/signature)
 */
export const handlePaymentWebhook = async (req, res, next) => {
  try {
    const {
      orderId,
      orderNumber,
      transactionId,
      status,
      amount,
      provider = "Gateway",
    } = req.body;

    const query = orderId ? { _id: orderId } : { orderNumber };
    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    if (status === "SUCCESS" || status === "COMPLETED" || status === "PAID") {
      await recordOnlineOrderPayment(order, {
        gatewayTransactionId: transactionId || order.orderNumber,
        paymentProvider: provider,
        rawGatewayResponse: req.body,
      });

      emitOrderStatusUpdate(
        order._id.toString(),
        order.customer?.toString(),
        order
      );
    } else if (status === "FAILED") {
      order.paymentStatus = "failed";
      await order.save();
    }

    res.status(200).json({
      success: true,
      received: true,
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get payment and ledger status for an order
 * @route   GET /api/payments/status/:orderId
 * @access  Private
 */
export const getPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId)
      .select("orderNumber totalAmount paymentMethod paymentStatus paymentDetails financialLedger refundStatus")
      .lean();

    if (!order) {
      return next(new AppError("Order not found", 404));
    }

    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
};

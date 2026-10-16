import PaymentMethod from "../models/PaymentMethod.js";
import { AppError } from "../middleware/errorMiddleware.js";

/**
 * Determine card brand from card number
 */
const detectCardType = (cardNumber) => {
  const clean = String(cardNumber).replace(/\D/g, "");
  if (/^4/.test(clean)) return "Visa";
  if (/^5[1-5]/.test(clean)) return "Mastercard";
  if (/^3[47]/.test(clean)) return "American Express";
  if (/^6(?:011|5)/.test(clean)) return "Discover";
  return "Visa";
};

/**
 * @desc    Get user's payment methods
 * @route   GET /api/payment-methods
 * @access  Private
 */
export const getPaymentMethods = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const allMethods = await PaymentMethod.find({ user: userId }).sort({
      createdAt: -1,
    });

    const cards = allMethods.filter((m) => m.type === "card");
    const wallets = allMethods.filter((m) => m.type === "wallet" && m.isLinked);
    const netbanking = allMethods.filter((m) => m.type === "netbanking" && m.isLinked);

    res.status(200).json({
      success: true,
      data: {
        cards,
        wallets,
        netbanking,
        all: allMethods,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add a credit or debit card
 * @route   POST /api/payment-methods/cards
 * @access  Private
 */
export const addCard = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      cardHolderName,
      cardNumber,
      expiryDate,
      nicknameType = "Personal",
    } = req.body;

    if (!cardHolderName || !cardNumber || !expiryDate) {
      return next(
        new AppError(
          "Please provide card holder name, card number, and expiry date",
          400
        )
      );
    }

    const cleanNumber = String(cardNumber).replace(/\D/g, "");
    if (cleanNumber.length < 12 || cleanNumber.length > 19) {
      return next(new AppError("Please provide a valid card number", 400));
    }

    const last4 = cleanNumber.slice(-4);
    const maskedNumber = `•••• •••• •••• ${last4}`;
    const detectedType = detectCardType(cleanNumber);

    // If this is the user's first card, make it default
    const existingCards = await PaymentMethod.countDocuments({
      user: userId,
      type: "card",
    });
    const isDefault = existingCards === 0;

    const newCard = await PaymentMethod.create({
      user: userId,
      type: "card",
      cardHolderName: cardHolderName.trim(),
      cardNumber: maskedNumber,
      last4,
      expiryDate: expiryDate.trim(),
      cardType: detectedType,
      nickname: nicknameType || "Personal",
      isDefault,
    });

    res.status(201).json({
      success: true,
      message: "Card added and securely stored successfully",
      data: newCard,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Link digital wallet (eSewa / Khalti)
 * @route   POST /api/payment-methods/wallets/link
 * @access  Private
 */
export const linkWallet = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { walletType, accountIdentifier } = req.body;

    if (!walletType || !accountIdentifier) {
      return next(
        new AppError("Please provide wallet type and account ID / phone number", 400)
      );
    }

    const normalizedType = String(walletType).toLowerCase().trim();
    if (!["esewa", "khalti"].includes(normalizedType)) {
      return next(
        new AppError("Wallet type must be either 'esewa' or 'khalti'", 400)
      );
    }

    // Upsert wallet record for this user
    let wallet = await PaymentMethod.findOne({
      user: userId,
      type: "wallet",
      walletType: normalizedType,
    });

    if (wallet) {
      wallet.accountIdentifier = accountIdentifier.trim();
      wallet.isLinked = true;
      await wallet.save();
    } else {
      wallet = await PaymentMethod.create({
        user: userId,
        type: "wallet",
        walletType: normalizedType,
        accountIdentifier: accountIdentifier.trim(),
        isLinked: true,
      });
    }

    res.status(200).json({
      success: true,
      message: `${normalizedType === "esewa" ? "eSewa" : "Khalti"} linked successfully`,
      data: wallet,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Unlink digital wallet
 * @route   DELETE /api/payment-methods/wallets/:walletType
 * @access  Private
 */
export const unlinkWallet = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { walletType } = req.params;

    const normalizedType = String(walletType).toLowerCase().trim();

    await PaymentMethod.findOneAndDelete({
      user: userId,
      type: "wallet",
      walletType: normalizedType,
    });

    res.status(200).json({
      success: true,
      message: `${normalizedType === "esewa" ? "eSewa" : "Khalti"} unlinked successfully`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Add / Connect Netbanking bank
 * @route   POST /api/payment-methods/netbanking
 * @access  Private
 */
export const addNetbanking = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { bankId, bankName, shortCode } = req.body;

    if (!bankId || !bankName) {
      return next(new AppError("Bank ID and bank name are required", 400));
    }

    // Check if bank already linked
    let existing = await PaymentMethod.findOne({
      user: userId,
      type: "netbanking",
      bankId,
    });

    if (existing) {
      existing.isLinked = true;
      existing.bankName = bankName;
      if (shortCode) existing.shortCode = shortCode;
      await existing.save();
    } else {
      existing = await PaymentMethod.create({
        user: userId,
        type: "netbanking",
        bankId,
        bankName,
        shortCode: shortCode || bankName,
        isLinked: true,
      });
    }

    res.status(200).json({
      success: true,
      message: `${bankName} connected successfully for Netbanking`,
      data: existing,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a saved card or bank payment method
 * @route   DELETE /api/payment-methods/:id
 * @access  Private
 */
export const deletePaymentMethod = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const method = await PaymentMethod.findOneAndDelete({
      _id: id,
      user: userId,
    });

    if (!method) {
      return next(new AppError("Payment method not found", 404));
    }

    res.status(200).json({
      success: true,
      message: "Payment method removed successfully",
    });
  } catch (error) {
    next(error);
  }
};

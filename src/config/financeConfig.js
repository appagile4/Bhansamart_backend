/**
 * Central Financial and Commission Configuration for BhansaMart
 *
 * Fixed Superadmin Commission: 1.5% of eligible product transaction amount.
 * Never configurable by vendors or clients.
 */

export const FINANCE_CONFIG = {
  // Superadmin fixed commission rate: 1.5%
  SUPERADMIN_COMMISSION_RATE: 0.015,

  // Configured delivery earning for COD deliveries (₹30)
  DEFAULT_COD_DELIVERY_EARNING: 30,

  // Default handling charge
  DEFAULT_HANDLING_CHARGE: 30,

  // Minimum withdrawal amount
  MIN_WITHDRAWAL_AMOUNT: 100,

  // Currency
  CURRENCY: "NPR",
};

/**
 * Accurately calculate commission and vendor net earnings with 2-decimal precision.
 * Avoids floating-point rounding issues.
 *
 * @param {number} eligibleAmount - Gross transaction/product amount
 * @param {number} [rate=0.015] - Commission rate (defaults to 1.5%)
 * @returns {{ grossAmount: number, commission: number, netAmount: number, rate: number }}
 */
export function calculateCommission(eligibleAmount, rate = FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE) {
  const gross = Math.max(0, Math.round(Number(eligibleAmount || 0) * 100) / 100);
  const commission = Math.round(gross * rate * 100) / 100;
  const net = Math.round((gross - commission) * 100) / 100;

  return {
    grossAmount: gross,
    commission,
    netAmount: net,
    rate,
  };
}

/**
 * Calculate pro-rata commission reversal on partial or full refund.
 *
 * @param {number} refundAmount - Amount refunded to customer
 * @param {number} [rate=0.015] - Commission rate
 * @returns {{ refundAmount: number, vendorDeduction: number, commissionReversal: number }}
 */
export function calculateRefundReversal(refundAmount, rate = FINANCE_CONFIG.SUPERADMIN_COMMISSION_RATE) {
  const refund = Math.max(0, Math.round(Number(refundAmount || 0) * 100) / 100);
  const commissionReversal = Math.round(refund * rate * 100) / 100;
  const vendorDeduction = Math.round((refund - commissionReversal) * 100) / 100;

  return {
    refundAmount: refund,
    vendorDeduction,
    commissionReversal,
  };
}

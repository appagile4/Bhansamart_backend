import crypto from "node:crypto";

/**
 * Generates a cryptographically secure 6-digit numeric OTP.
 * Uses crypto.randomInt to prevent predictable pseudo-random sequences.
 * @returns {string} 6-digit OTP string (e.g., "725501")
 */
export const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const generateNumericOTP = (length = 6) => {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length);
  return crypto.randomInt(min, max).toString();
};

/**
 * Hashes an OTP or secret value using SHA-256 for secure database storage.
 * @param {string} value - The plaintext OTP or token
 * @returns {string} Hex encoded SHA-256 hash
 */
export const hashData = (value) => {
  return crypto.createHash("sha256").update(value.toString()).digest("hex");
};

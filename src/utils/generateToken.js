import jwt from "jsonwebtoken";

/**
 * Generate standard JWT Access Token for authenticated user sessions
 * @param {Object} user - User document or object with _id, email, and role
 * @returns {string} JWT Access Token
 */
export const generateAccessToken = (user) => {
  const payload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role || "user",
  };

  const secret = process.env.JWT_SECRET || "default_jwt_secret_change_in_production";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Generate a short-lived token specifically for completing a password reset
 * @param {string} userId - User ID
 * @returns {string} Password Reset Token
 */
export const generateResetToken = (userId) => {
  const payload = {
    userId: userId.toString(),
    purpose: "password_reset",
  };

  const secret = process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET || "default_reset_secret";
  const expiresIn = process.env.RESET_TOKEN_EXPIRES_IN || "10m";

  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Verify a short-lived password reset token
 * @param {string} token - The reset token to verify
 * @returns {Object} Decoded JWT payload
 */
export const verifyResetToken = (token) => {
  const secret = process.env.RESET_TOKEN_SECRET || process.env.JWT_SECRET || "default_reset_secret";
  return jwt.verify(token, secret);
};

import jwt from "jsonwebtoken";

/**
 * Generate standard JWT Access Token for authenticated user sessions
 * @param {Object} user - User document or object with _id, email, and role
 * @returns {string} JWT Access Token
 */
export const generateAccessToken = (user) => {
  const payload = {
    userId: user._id ? user._id.toString() : user.toString(),
    email: user.email,
    role: user.role || "user",
  };

  const secret = process.env.JWT_SECRET || "default_jwt_secret_change_in_production";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Generate Token and optionally set HTTP-only cookie
 */
export const generateTokenAndSetCookie = (res, userId, role = "user") => {
  const payload = {
    userId: userId.toString(),
    role,
  };

  const secret = process.env.JWT_SECRET || "default_jwt_secret_change_in_production";
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  const token = jwt.sign(payload, secret, { expiresIn });

  if (res && res.cookie) {
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  return token;
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

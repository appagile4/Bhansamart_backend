import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { AppError } from "./errorMiddleware.js";

/**
 * Middleware to protect routes and verify JWT authentication
 */
export const protect = async (req, res, next) => {
  try {
    let token;

    // 1. Extract Bearer token from Authorization header or cookies
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return next(
        new AppError("Authentication required. Please log in to access this resource.", 401)
      );
    }

    // 2. Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "default_jwt_secret_change_in_production"
    );

    // 3. Check if user still exists
    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      return next(
        new AppError("The user belonging to this session no longer exists.", 401)
      );
    }

    // 4. Check if user is active
    if (!currentUser.isActive) {
      return next(
        new AppError("Your account has been deactivated. Please contact support.", 403)
      );
    }

    // 5. Check if user changed password after token was issued
    if (decoded.iat && currentUser.changedPasswordAfter(decoded.iat)) {
      return next(
        new AppError("Password was recently changed. Please log in again.", 401)
      );
    }

    // 6. Grant access by attaching user to request
    req.user = currentUser;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware for Role-Based Authorization
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'user')
 */
export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError("You do not have permission to perform this action.", 403)
      );
    }
    next();
  };
};

/**
 * Middleware to optionally attach user if authenticated, without blocking if guest
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (token) {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "default_jwt_secret_change_in_production"
      );
      const currentUser = await User.findById(decoded.userId);
      if (currentUser && currentUser.isActive) {
        req.user = currentUser;
      }
    }
    next();
  } catch (e) {
    next();
  }
};


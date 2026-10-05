/**
 * Custom Operational Application Error Class
 */
export class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Middleware to catch 404 Route Not Found
 */
export const notFoundHandler = (req, res, next) => {
  next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404));
};

/**
 * Centralized Error Handling Middleware
 */
export const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Handle Mongoose Bad ObjectId (CastError)
  if (err.name === "CastError") {
    const message = `Resource not found with id of ${err.value}`;
    error = new AppError(message, 404);
  }

  // Handle Mongoose Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    const value = err.keyValue ? err.keyValue[field] : "";
    const message = `An account with ${field} '${value}' already exists. Please use a different ${field}.`;
    error = new AppError(message, 400);
  }

  // Handle Mongoose Validation Error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((val) => val.message);
    const message = `Invalid input data: ${errors.join(". ")}`;
    error = new AppError(message, 400);
  }

  // Handle JWT Invalid Token Error
  if (err.name === "JsonWebTokenError") {
    const message = "Invalid authentication token. Please log in again.";
    error = new AppError(message, 401);
  }

  // Handle JWT Expired Token Error
  if (err.name === "TokenExpiredError") {
    const message = "Your authentication session has expired. Please log in again.";
    error = new AppError(message, 401);
  }

  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    message: error.message || "Internal Server Error",
    errors: error.errors || (error.message ? [error.message] : []),
  };

  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

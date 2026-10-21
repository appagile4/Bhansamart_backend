import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/authRoutes.js";
import vendorAuthRoutes from "./routes/vendorAuthRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import wishlistRoutes from "./routes/wishlistRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import addressRoutes from "./routes/addressRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import deliveryAuthRoutes from "./routes/deliveryAuthRoutes.js";
import deliveryDocumentRoutes from "./routes/deliveryDocumentRoutes.js";
import deliveryDepositRoutes from "./routes/deliveryDepositRoutes.js";
import deliveryLocationRoutes from "./routes/deliveryLocationRoutes.js";
import deliveryAssignmentRoutes from "./routes/deliveryAssignmentRoutes.js";
import deliveryEarningsRoutes from "./routes/deliveryEarningsRoutes.js";
import adminDeliveryRoutes from "./routes/adminDeliveryRoutes.js";
import referralRoutes, { rewardsRouter } from "./routes/referralRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminReferralRoutes from "./routes/adminReferralRoutes.js";
import paymentMethodRoutes from "./routes/paymentMethodRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import refundRoutes from "./routes/refundRoutes.js";
import brandRoutes from "./routes/brandRoutes.js";
import attributeRoutes from "./routes/attributeRoutes.js";
import { notFoundHandler, errorHandler } from "./middleware/errorMiddleware.js";

const app = express();


// 1. Security HTTP Headers
app.use(helmet());

// 2. Cross-Origin Resource Sharing (CORS) configuration for React Native & Web
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:8081", // React Native Metro Bundler
  "http://localhost:19006", // Expo Web
  "http://192.168.29.235:8081",
  "http://192.168.29.235:19006",
  "http://192.168.29.235:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, Postman, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === "development") {
        return callback(null, true);
      }
      return callback(new Error("CORS policy: Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// 3. Global General Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
});
app.use("/api", globalLimiter);

// 4. Body parsers (Support base64 image strings & large multipart payloads)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// 5. Health Check & Root Endpoints
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BhansaMart E-Commerce Server is running smoothly.",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api", (req, res) => {
  res.status(200).json({
    success: true,
    message: "BhansaMart API is online and ready.",
    endpoints: {
      auth: "/api/auth",
      vendorAuth: "/api/auth/vendor",
      vendor: "/api/vendor",
      products: "/api/products",
      health: "/api/health",
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "UP",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 6. Mount Feature Routes
app.use("/api/auth/vendor", vendorAuthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/products", productRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/address", addressRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/refunds", refundRoutes);
app.use("/api/payment-methods", paymentMethodRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/attributes", attributeRoutes);

// Delivery Boy Module Routes
app.use("/api/delivery/auth", deliveryAuthRoutes);
app.use("/api/delivery/documents", deliveryDocumentRoutes);
app.use("/api/delivery/deposit", deliveryDepositRoutes);
app.use("/api/delivery/availability", deliveryLocationRoutes);
app.use("/api/delivery/location", deliveryLocationRoutes);
app.use("/api/delivery/assignments", deliveryAssignmentRoutes);
app.use("/api/delivery/earnings", deliveryEarningsRoutes);

// Admin Delivery Management Routes
app.use("/api/admin/delivery", adminDeliveryRoutes);

// Referral & Reward Points Module Routes (v1 & unversioned)
app.use("/api/v1/referrals", referralRoutes);
app.use("/api/v1/rewards", rewardsRouter);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/admin/referrals", adminReferralRoutes);

app.use("/api/referrals", referralRoutes);
app.use("/api/rewards", rewardsRouter);
app.use("/api/notifications", notificationRoutes);



// 7. Catch Unhandled 404 Routes
app.use(notFoundHandler);

// 8. Global Error Handling Middleware
app.use(errorHandler);

export default app;

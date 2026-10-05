import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import connectDB from "./config/db.js";

// Handle uncaught exceptions across the application
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception] Shutting down server...", err);
  process.exit(1);
});

// Connect to MongoDB
connectDB();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const server = app.listen(PORT, HOST, () => {
  console.log(
    `[Server] BhansaMart Auth Server running in ${process.env.NODE_ENV || "development"} mode:`
  );
  console.log(`  - Local:   http://localhost:${PORT}`);
  console.log(`  - Network: http://192.168.29.235:${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection] Shutting down gracefully...", err);
  server.close(() => {
    process.exit(1);
  });
});

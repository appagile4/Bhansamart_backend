import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app.js";
import connectDB from "./config/db.js";
import { initSocket } from "./socket/socketManager.js";
import { recoverStaleAssignments } from "./utils/dispatchEngine.js";

// Handle uncaught exceptions across the application
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception] Shutting down server...", err);
  process.exit(1);
});

// Connect to MongoDB
connectDB();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

// Create native Node HTTP Server reusing Express app
const server = http.createServer(app);

// Initialize Socket.IO with unified HTTP Server
initSocket(server);

// Background recovery for stale delivery assignments across server restarts
setTimeout(() => {
  recoverStaleAssignments().catch((err) =>
    console.warn("[Recovery Stale Assignments warning]:", err.message)
  );
  setInterval(() => {
    recoverStaleAssignments().catch(() => {});
  }, 60000);
}, 5000);

server.listen(PORT, HOST, () => {
  console.log(
    `[Server] BhansaMart Core & Real-time Server running in ${process.env.NODE_ENV || "development"} mode:`
  );
  console.log(`  - Local:   http://localhost:${PORT}`);
  console.log(`  - Network: http://192.168.29.235:${PORT}`);
  console.log(`  - Socket:  ws://192.168.29.235:${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("[Unhandled Rejection] Shutting down gracefully...", err);
  server.close(() => {
    process.exit(1);
  });
});

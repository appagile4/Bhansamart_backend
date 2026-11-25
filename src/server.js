import dotenv from "dotenv";
dotenv.config();

import http from "http";
import app from "./app.js";
import connectDB from "./config/db.js";
import { initSocket } from "./socket/socketManager.js";
import { recoverStaleAssignments } from "./utils/dispatchEngine.js";
import { closeRedis } from "./config/redis.js";
import redisDispatchService from "./services/redisDispatchService.js";

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

// Background recovery for stale delivery assignments & Redis rider reconciliation across server restarts
setTimeout(() => {
  redisDispatchService.reconcileOnlineRiders().catch((err) =>
    console.warn("[Redis Rider Reconciliation warning]:", err.message)
  );
  recoverStaleAssignments().catch((err) =>
    console.warn("[Recovery Stale Assignments warning]:", err.message)
  );
  setInterval(() => {
    recoverStaleAssignments().catch(() => {});
  }, 60000);
}, 5000);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[Server Error] Port ${PORT} is already in use by another process.`);
    console.error(`To free port ${PORT} immediately, run:`);
    console.error(`  Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force\n`);
  } else {
    console.error("[Server Error]", err);
  }
  process.exit(1);
});

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
  server.close(async () => {
    await closeRedis();
    process.exit(1);
  });
});

// Graceful termination handling
const handleGracefulShutdown = async (signal) => {
  console.log(`[Server] Received ${signal}. Closing HTTP server and Redis...`);
  server.close(async () => {
    await closeRedis();
    process.exit(0);
  });
};

process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

// Clean restart hook for nodemon on Windows
process.once("SIGUSR2", async () => {
  server.close(async () => {
    await closeRedis();
    process.kill(process.pid, "SIGUSR2");
  });
});


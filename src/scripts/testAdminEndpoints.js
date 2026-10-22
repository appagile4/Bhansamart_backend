import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import app from "../app.js";

async function testAdminEndpoints() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[OK] Connected to MongoDB");

    const superadmin = await User.findOne({ role: "superadmin" });
    if (!superadmin) {
      console.error("[FAIL] Superadmin user not found");
      process.exit(1);
    }

    const token = jwt.sign(
      { userId: superadmin._id, role: superadmin.role },
      process.env.JWT_SECRET || "default_jwt_secret_change_in_production",
      { expiresIn: "1h" }
    );

    console.log(`[OK] Generated token for Superadmin: ${superadmin.email}`);

    // Test importing and executing controller methods directly
    const { getAdminDashboardStats, getCategoriesAdmin } = await import("../controllers/adminManagementController.js");

    const mockReq = {
      user: superadmin,
      query: { timeframe: "today" },
      accessibleVendorIds: null,
    };

    let responseData = null;
    const mockRes = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    const mockNext = (err) => {
      if (err) throw err;
    };

    await getAdminDashboardStats(mockReq, mockRes, mockNext);
    console.log("[OK] getAdminDashboardStats succeeded! Output KPIs:");
    console.log(JSON.stringify(responseData?.data?.kpi, null, 2));

    await getCategoriesAdmin(mockReq, mockRes, mockNext);
    console.log("[OK] getCategoriesAdmin succeeded! Categories count:", responseData?.data?.all?.length);

    console.log("\n✅ ALL BACKEND ADMIN CONTROLLER TESTS PASSED!");
    process.exit(0);
  } catch (err) {
    console.error("[FAIL] Test error:", err);
    process.exit(1);
  }
}

testAdminEndpoints();

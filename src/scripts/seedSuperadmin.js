import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";

async function seedSuperadmin() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("[ERROR] MONGODB_URI not found in environment.");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("[OK] Connected to MongoDB database.");

    // Retrieve credentials from environment or CLI arguments
    const email = (process.env.SUPERADMIN_EMAIL || process.argv[2] || "superadmin@bhansamart.com").toLowerCase().trim();
    const password = process.env.SUPERADMIN_PASSWORD || process.argv[3] || "Superadmin@Bhansa2026!";
    const name = process.env.SUPERADMIN_NAME || process.argv[4] || "Chief Superadmin";

    let superadmin = await User.findOne({ email });

    if (superadmin) {
      superadmin.role = "superadmin";
      superadmin.name = name;
      superadmin.password = password; // pre-save will re-hash
      superadmin.isActive = true;
      superadmin.isEmailVerified = true;
      await superadmin.save();
      console.log(`[OK] Updated existing user ${email} to 'superadmin' role successfully.`);
    } else {
      superadmin = await User.create({
        name,
        email,
        password,
        role: "superadmin",
        isActive: true,
        isEmailVerified: true,
      });
      console.log(`[OK] Created new Superadmin account for ${email} successfully.`);
    }

    console.log("==================================================================");
    console.log("   ✅ SUPERADMIN BOOTSTRAP COMPLETE");
    console.log(`   Email: ${email}`);
    console.log(`   Role:  superadmin`);
    console.log("==================================================================");

    process.exit(0);
  } catch (error) {
    console.error("[FAIL] Bootstrap failed:", error);
    process.exit(1);
  }
}

seedSuperadmin();

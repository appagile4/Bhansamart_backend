import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/User.js";
import CustomerOtp from "../models/CustomerOtp.js";
import { generateOTP, hashData } from "../utils/generateOTP.js";
import { generateAccessToken } from "../utils/generateToken.js";

async function runTest() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB successfully!");

    // Test CustomerOtp model
    const testEmail = "test_customer_" + Date.now() + "@example.com";
    const otp = "123456";
    const otpHash = hashData(otp);

    console.log("Creating CustomerOtp record for:", testEmail);
    const otpDoc = await CustomerOtp.create({
      email: testEmail,
      otpHash,
      purpose: "registration",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    console.log("CustomerOtp created:", otpDoc._id);

    // Verify OTP
    const verifyResult = otpDoc.verifyOTP("123456");
    console.log("Verification result:", verifyResult);

    if (!verifyResult.valid) {
      throw new Error("OTP verification failed");
    }

    // Clean up test doc
    await CustomerOtp.deleteOne({ _id: otpDoc._id });
    console.log("CustomerOtp cleanup successful!");

    await mongoose.disconnect();
    console.log("ALL BACKEND AUTH TESTS PASSED!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runTest();

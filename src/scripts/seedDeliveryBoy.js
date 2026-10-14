import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function seedDeliveryBoy() {
  console.log("================================================================================");
  console.log("   SEEDING VERIFIED DELIVERY PARTNER INTO DATABASE");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB database.");

    const email = "delivery@bhansamart.com";
    const phone = "9841000000";
    const password = "Password123";

    // 1. Check or Create User
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: "Ram Bahadur Thapa",
        email,
        phone,
        password, // User pre-save hook will hash this with bcrypt
        role: "delivery_boy",
        status: "approved",
        isApproved: true,
        isActive: true,
      });
      console.log(`[OK] Created User account: ${user.name} (${user.email})`);
    } else {
      user.role = "delivery_boy";
      user.status = "approved";
      user.isApproved = true;
      user.isActive = true;
      user.password = password; // Will be re-hashed by pre-save
      await user.save();
      console.log(`[OK] Updated existing User account: ${user.name} (${user.email})`);
    }

    // 2. Check or Create DeliveryBoy Profile
    let deliveryBoy = await DeliveryBoy.findOne({ user: user._id });

    const depositTxId = `DEP-SEED-1000`;

    const profileData = {
      user: user._id,
      fullName: "Ram Bahadur Thapa",
      phone,
      email,
      dateOfBirth: new Date("1996-05-15"),
      serviceCity: "Kathmandu",
      serviceArea: "Thamel / Central Kathmandu",
      currentAddress: {
        addressLine: "Thamel Marg, House No. 42",
        city: "Kathmandu",
        state: "Bagmati",
        pincode: "44600",
      },
      emergencyContact: {
        name: "Sita Thapa",
        relationship: "Spouse",
        phone: "9841999999",
      },
      vehicleDetails: {
        vehicleType: "Motorcycle",
        registrationNumber: "BA 2 PA 9876",
        licenseNumber: "DL-01-2022-7777",
      },
      bankDetails: {
        accountHolderName: "Ram Bahadur Thapa",
        accountNumber: "012345678901",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
        upiId: "rambahadur@upi",
      },
      documents: {
        panCard: {
          documentNumber: "ABCDE1234F",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        aadhaarCard: {
          documentNumber: "123456789012",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        drivingLicense: {
          documentNumber: "DL-01-2022-7777",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        vehicleRc: {
          documentNumber: "BA-2-PA-9876",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
      },
      securityDeposit: {
        requiredAmount: 1000,
        paidAmount: 1000,
        status: "PAID",
        paidAt: new Date(),
        transactionId: depositTxId,
        gateway: "eSewa",
      },
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      adminRemarks: "Pre-verified official seed delivery partner.",
      availability: "ONLINE",
      currentLocation: {
        type: "Point",
        coordinates: [85.3240, 27.7172], // Central Kathmandu coords
      },
      lastLocationUpdatedAt: new Date(),
      metrics: {
        totalDeliveries: 28,
        rating: 4.9,
        ratingsCount: 26,
        acceptanceRate: 98,
      },
      wallet: {
        currentBalance: 320,
        totalEarned: 1840,
      },
    };

    if (!deliveryBoy) {
      deliveryBoy = await DeliveryBoy.create(profileData);
      console.log(`[OK] Created DeliveryBoy profile: ${deliveryBoy.fullName} (ID: ${deliveryBoy._id})`);
    } else {
      Object.assign(deliveryBoy, profileData);
      await deliveryBoy.save();
      console.log(`[OK] Updated DeliveryBoy profile: ${deliveryBoy.fullName} (ID: ${deliveryBoy._id})`);
    }

    // 3. Ensure SecurityDepositLedger Entry Exists
    let depositLedger = await SecurityDepositLedger.findOne({ transactionId: depositTxId });
    if (!depositLedger) {
      depositLedger = await SecurityDepositLedger.create({
        deliveryBoy: deliveryBoy._id,
        user: user._id,
        amount: 1000,
        currency: "INR",
        type: "DEPOSIT_PAYMENT",
        status: "PAID",
        paymentGateway: "eSewa",
        transactionId: depositTxId,
        gatewayReference: "ESEWA-REF-88991122",
        paidAt: new Date(),
      });
      console.log(`[OK] Created SecurityDepositLedger record: ₹${depositLedger.amount} (Status: ${depositLedger.status})`);
    } else {
      depositLedger.status = "PAID";
      await depositLedger.save();
      console.log(`[OK] SecurityDepositLedger confirmed: ₹${depositLedger.amount}`);
    }

    console.log("\n================================================================================");
    console.log("   DELIVERY PARTNER SEED COMPLETED SUCCESSFULLY!");
    console.log("================================================================================");
    console.log("   LOGIN CREDENTIALS:");
    console.log(`   • Email:    ${email}`);
    console.log(`   • Phone:    ${phone}`);
    console.log(`   • Password: ${password}`);
    console.log("   ----------------------------------------------------------------------------");
    console.log(`   • Name:         ${deliveryBoy.fullName}`);
    console.log(`   • Status:       ${deliveryBoy.approvalStatus} (Approved by Admin)`);
    console.log(`   • Availability: ${deliveryBoy.availability} (Ready to receive orders)`);
    console.log(`   • Documents:    All 4 Verified (PAN, Aadhaar, License, RC)`);
    console.log(`   • Deposit:      ₹1,000 PAID in SecurityDepositLedger`);
    console.log(`   • Location:     [85.3240, 27.7172] (Central Kathmandu)`);
    console.log("================================================================================\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ SEEDING FAILED:", error);
    process.exit(1);
  }
}

seedDeliveryBoy();

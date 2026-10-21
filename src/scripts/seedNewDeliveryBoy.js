import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

async function seedNewDeliveryBoy() {
  console.log("================================================================================");
  console.log("   SEEDING BRAND NEW FULLY-VERIFIED DELIVERY PARTNER");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB database.");

    const email = "rider@bhansamart.com";
    const phone = "9851000001";
    const password = "Password123";
    const fullName = "Bikash Gurung";

    // 1. Create or Update User account
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: fullName,
        email,
        phone,
        password, // user pre-save hook will hash this via bcrypt
        role: "delivery_boy",
        status: "approved",
        isApproved: true,
        isActive: true,
      });
      console.log(`[OK] Created User account: ${user.name} (${user.email})`);
    } else {
      user.name = fullName;
      user.role = "delivery_boy";
      user.status = "approved";
      user.isApproved = true;
      user.isActive = true;
      user.password = password; // Will be re-hashed by pre-save
      await user.save();
      console.log(`[OK] Reset password & updated User account: ${user.name} (${user.email})`);
    }

    // 2. Check or Create DeliveryBoy Profile
    let deliveryBoy = await DeliveryBoy.findOne({ user: user._id });
    const depositTxId = `DEP-NEW-${Date.now()}`;

    const profileData = {
      user: user._id,
      fullName,
      phone,
      email,
      dateOfBirth: new Date("1998-08-20"),
      serviceCity: "Kathmandu",
      serviceArea: "Kathmandu Valley / New Baneshwor",
      currentAddress: {
        addressLine: "New Baneshwor Marg, Ward No. 10",
        city: "Kathmandu",
        state: "Bagmati",
        pincode: "44600",
      },
      emergencyContact: {
        name: "Sunita Gurung",
        relationship: "Sister",
        phone: "9851999999",
      },
      vehicleDetails: {
        vehicleType: "Motorcycle",
        registrationNumber: "BA 3 PA 4567",
        licenseNumber: "DL-01-2023-8888",
      },
      bankDetails: {
        accountHolderName: fullName,
        accountNumber: "987654321098",
        ifscCode: "NABIL0001",
        bankName: "Nabil Bank",
        upiId: "bikashgurung@esewa",
      },
      documents: {
        panCard: {
          documentNumber: "ABCDE5678G",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        aadhaarCard: {
          documentNumber: "987654321098",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        drivingLicense: {
          documentNumber: "DL-01-2023-8888",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        vehicleRc: {
          documentNumber: "BA-3-PA-4567",
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
      adminRemarks: "Fully-verified delivery partner account.",
      availability: "ONLINE",
      currentLocation: {
        type: "Point",
        coordinates: [85.3240, 27.7172], // Central Kathmandu / Baneshwor
      },
      lastLocationUpdatedAt: new Date(),
      metrics: {
        totalDeliveries: 35,
        rating: 5.0,
        ratingsCount: 30,
        acceptanceRate: 100,
      },
      wallet: {
        currentBalance: 0,
        totalEarned: 0,
      },
      codCashInCustody: 0,
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
    const depositLedger = await SecurityDepositLedger.create({
      deliveryBoy: deliveryBoy._id,
      user: user._id,
      amount: 1000,
      currency: "INR",
      type: "DEPOSIT_PAYMENT",
      status: "PAID",
      paymentGateway: "eSewa",
      transactionId: depositTxId,
      gatewayReference: `ESEWA-REF-${Date.now()}`,
      paidAt: new Date(),
    });
    console.log(`[OK] Created SecurityDepositLedger entry: ₹${depositLedger.amount} (Status: ${depositLedger.status})`);

    console.log("\n================================================================================");
    console.log("   ✅ NEW DELIVERY PARTNER SEEDED SUCCESSFULLY!");
    console.log("================================================================================");
    console.log("   LOGIN CREDENTIALS:");
    console.log(`   • Email:        ${email}`);
    console.log(`   • Password:     ${password}`);
    console.log(`   • Phone:        ${phone}`);
    console.log("   ----------------------------------------------------------------------------");
    console.log(`   • Name:         ${deliveryBoy.fullName}`);
    console.log(`   • Role:         delivery_boy`);
    console.log(`   • Status:       ${deliveryBoy.approvalStatus} (Approved by Admin)`);
    console.log(`   • Availability: ${deliveryBoy.availability} (Active & ready for orders)`);
    console.log(`   • Deposit:      ₹1,000 PAID (Verified in SecurityDepositLedger)`);
    console.log(`   • Documents:    All Verified (PAN, Aadhaar/Citizenship, Driving License, RC)`);
    console.log(`   • Vehicle:      BA 3 PA 4567 (Motorcycle)`);
    console.log(`   • Location:     [85.3240, 27.7172] (Kathmandu)`);
    console.log("================================================================================\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ SEEDING FAILED:", error);
    process.exit(1);
  }
}

seedNewDeliveryBoy();

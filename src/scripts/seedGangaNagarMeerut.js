import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

// Coordinates for Ganga Nagar, Meerut, Uttar Pradesh 250001
// Latitude: 29.0032° N, Longitude: 77.7578° E
const GANGA_NAGAR_COORDS = {
  latitude: 29.0032,
  longitude: 77.7578,
  addressLine: "Shop No. 12, Main Commercial Market, Ganga Nagar",
  city: "Meerut",
  state: "Uttar Pradesh",
  pincode: "250001",
  fullAddress: "Ganga Nagar, Meerut, Uttar Pradesh 250001 (गंगा नगर, मेरठ, उत्तर प्रदेश 250001)",
};

async function seedGangaNagar() {
  console.log("================================================================================");
  console.log("   SEEDING GANGA NAGAR, MEERUT (UP 250001) - VENDOR, PRODUCTS & DELIVERY BOY");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB database.");

    // =========================================================================
    // 1. SEED VENDOR IN GANGA NAGAR, MEERUT
    // =========================================================================
    console.log("\n--- 1. Creating / Updating Ganga Nagar Vendor User ---");
    const vendorEmail = "vendor.ganganagar@bhansamart.com";
    const vendorPhone = "9876525001";
    const vendorPassword = "Password@123";
    const vendorOwnerName = "Suresh Verma";
    const storeName = "Ganga Nagar Fresh Supermart";

    let vendorUser = await User.findOne({ email: vendorEmail });
    if (!vendorUser) {
      vendorUser = await User.create({
        name: vendorOwnerName,
        email: vendorEmail,
        phone: vendorPhone,
        password: vendorPassword, // Password will be hashed by User pre-save hook
        address: GANGA_NAGAR_COORDS.fullAddress,
        role: "vendor",
        status: "active",
        isApproved: true,
        isEmailVerified: true,
        isActive: true,
      });
      console.log(`[OK] Created Vendor User Account: ${vendorUser.name} (${vendorUser.email})`);
    } else {
      vendorUser.name = vendorOwnerName;
      vendorUser.phone = vendorPhone;
      vendorUser.address = GANGA_NAGAR_COORDS.fullAddress;
      vendorUser.role = "vendor";
      vendorUser.status = "active";
      vendorUser.isApproved = true;
      vendorUser.isEmailVerified = true;
      vendorUser.isActive = true;
      vendorUser.password = vendorPassword; // Will be re-hashed by pre-save
      await vendorUser.save();
      console.log(`[OK] Updated Existing Vendor User Account: ${vendorUser.email}`);
    }

    console.log("\n--- Creating / Updating Ganga Nagar Vendor Document ---");
    let vendor = await Vendor.findOne({ userId: vendorUser._id });

    const vendorPayload = {
      userId: vendorUser._id,
      businessDetails: {
        businessName: storeName,
        businessType: "Sole Proprietorship",
        gstNumber: "09AAACB9876D1Z5", // 09 = UP State Code
        panNumber: "AAACB9876D",
        businessEmail: vendorEmail,
        businessPhone: vendorPhone,
        registeredAddress: GANGA_NAGAR_COORDS.addressLine,
        city: GANGA_NAGAR_COORDS.city,
        state: GANGA_NAGAR_COORDS.state,
        pincode: GANGA_NAGAR_COORDS.pincode,
        country: "India",
        yearEstablished: 2023,
        numberOfEmployees: 8,
        categories: ["Grocery & Kitchen", "Fresh Vegetables", "Dairy & Eggs", "Snacks & Drinks"],
        retailChannel: "Omnichannel (Store & Online Delivery)",
      },
      sellerDetails: {
        sellerName: vendorOwnerName,
        sellerEmail: vendorEmail,
        sellerPhone: vendorPhone,
        address: GANGA_NAGAR_COORDS.addressLine,
        city: GANGA_NAGAR_COORDS.city,
        state: GANGA_NAGAR_COORDS.state,
        pincode: GANGA_NAGAR_COORDS.pincode,
      },
      shippingLocations: {
        warehouseAddress: GANGA_NAGAR_COORDS.addressLine,
        city: GANGA_NAGAR_COORDS.city,
        state: GANGA_NAGAR_COORDS.state,
        pincode: GANGA_NAGAR_COORDS.pincode,
        latitude: GANGA_NAGAR_COORDS.latitude,
        longitude: GANGA_NAGAR_COORDS.longitude,
      },
      deliveryRadiusKm: 10.0, // 10 km delivery radius covering Ganga Nagar & surrounding Meerut
      isStoreOpen: true,
      location: {
        type: "Point",
        coordinates: [GANGA_NAGAR_COORDS.longitude, GANGA_NAGAR_COORDS.latitude], // GeoJSON: [lng, lat]
      },
      status: "approved",
      adminRemark: "Verified Ganga Nagar Meerut official vendor.",
    };

    if (!vendor) {
      vendor = await Vendor.create(vendorPayload);
      console.log(`[OK] Created Vendor Profile: ${vendor.businessDetails.businessName} (ID: ${vendor._id})`);
    } else {
      Object.assign(vendor, vendorPayload);
      await vendor.save();
      console.log(`[OK] Updated Vendor Profile: ${vendor.businessDetails.businessName} (ID: ${vendor._id})`);
    }

    // =========================================================================
    // 2. SEED 2 PRODUCTS FOR THIS VENDOR
    // =========================================================================
    console.log("\n--- 2. Seeding 2 Products for Ganga Nagar Vendor ---");
    const PRODUCTS_DATA = [
      {
        name: "Amul Gold Full Cream Fresh Milk",
        category: "Grocery & Kitchen",
        subCategory: "Dairy & Breakfast",
        price: 34,
        originalPrice: 36,
        unit: "500 ml Pouch",
        stock: 120,
        brand: "Amul",
        description:
          "Fresh pasteurized homogenized full cream milk rich in natural nutrients, calcium, and protein. Ideal for daily tea, coffee, curd, and milkshakes.",
        image:
          "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&auto=format&fit=crop&q=80",
        tags: ["Milk", "Dairy", "Amul", "Breakfast", "Fresh", "Ganga Nagar"],
      },
      {
        name: "Fresh Farm Red Onions / Pyaaz",
        category: "Grocery & Kitchen",
        subCategory: "Vegetables & Fruits",
        price: 35,
        originalPrice: 45,
        unit: "1 kg",
        stock: 200,
        brand: "Farm Fresh",
        description:
          "Crisp, firm, and pungent farm-fresh red onions directly sourced for everyday Indian curries, salads, and cooking.",
        image:
          "https://images.unsplash.com/photo-1618512496248-a07fe83aa8cb?w=800&auto=format&fit=crop&q=80",
        tags: ["Onion", "Pyaaz", "Vegetables", "Fresh", "Daily Staples", "Ganga Nagar"],
      },
    ];

    const seededProducts = [];

    for (const prod of PRODUCTS_DATA) {
      const baseSlug = String(prod.name)
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const productSlug = `${baseSlug}-ganganagar-${vendor._id.toString().slice(-4)}`;
      const sku = `GNG-${prod.brand.slice(0, 3).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;

      const productPayload = {
        vendor: vendor._id,
        user: vendorUser._id,
        name: prod.name,
        slug: productSlug,
        description: prod.description,
        shortDescription: prod.description.slice(0, 100),
        category: prod.category,
        subCategory: prod.subCategory,
        supplierName: storeName,
        brand: prod.brand,
        expirationDate: "12/2026",
        price: prod.price,
        originalPrice: prod.originalPrice,
        discountCategory: "Ganga Nagar Opening Special",
        discountValue: prod.originalPrice - prod.price,
        discount: parseFloat(
          (((prod.originalPrice - prod.price) / prod.originalPrice) * 100).toFixed(2)
        ),
        sku,
        stock: prod.stock,
        reorderLevel: 10,
        unit: prod.unit,
        inStock: prod.stock > 0,
        images: [
          {
            url: prod.image,
            publicId: `seed-ganganagar-${baseSlug}`,
            altText: prod.name,
          },
        ],
        variants: [
          {
            type: "Standard",
            weightUnit: prod.unit.split(" ")[1] || "kg",
            weightValue: prod.unit.split(" ")[0] || "1",
            color: "Natural",
            price: prod.price,
            sku: `${sku}-STD`,
            stock: prod.stock,
          },
        ],
        tags: prod.tags,
        status: "Active",
        visibility: {
          isFeatured: true,
          isBestSeller: true,
          isNewArrival: true,
        },
        ratingsAverage: 4.8,
        ratingsCount: 42,
        views: 240,
        ordersCount: 65,
        isActive: true,
        isDeleted: false,
      };

      let productDoc = await Product.findOne({
        name: prod.name,
        vendor: vendor._id,
      });

      if (productDoc) {
        productDoc = await Product.findByIdAndUpdate(productDoc._id, productPayload, { new: true });
        console.log(`[OK] Updated Product: "${productDoc.name}" (₹${productDoc.price}) - SKU: ${productDoc.sku}`);
      } else {
        productDoc = await Product.create(productPayload);
        console.log(`[OK] Created Product: "${productDoc.name}" (₹${productDoc.price}) - SKU: ${productDoc.sku}`);
      }
      seededProducts.push(productDoc);
    }

    // =========================================================================
    // 3. SEED 1 DELIVERY BOY IN GANGA NAGAR, MEERUT
    // =========================================================================
    console.log("\n--- 3. Creating / Updating Ganga Nagar Delivery Boy ---");
    const riderEmail = "rider.ganganagar@bhansamart.com";
    const riderPhone = "9876525002";
    const riderPassword = "Password@123";
    const riderName = "Deepak Kumar (Ganga Nagar Delivery)";

    let riderUser = await User.findOne({ email: riderEmail });
    if (!riderUser) {
      riderUser = await User.create({
        name: riderName,
        email: riderEmail,
        phone: riderPhone,
        password: riderPassword, // User pre-save hashes this
        address: GANGA_NAGAR_COORDS.fullAddress,
        role: "delivery_boy",
        status: "approved",
        isApproved: true,
        isActive: true,
      });
      console.log(`[OK] Created Delivery Partner User: ${riderUser.name} (${riderUser.email})`);
    } else {
      riderUser.name = riderName;
      riderUser.phone = riderPhone;
      riderUser.address = GANGA_NAGAR_COORDS.fullAddress;
      riderUser.role = "delivery_boy";
      riderUser.status = "approved";
      riderUser.isApproved = true;
      riderUser.isActive = true;
      riderUser.password = riderPassword; // Will be re-hashed by pre-save
      await riderUser.save();
      console.log(`[OK] Updated Existing Delivery Partner User: ${riderUser.email}`);
    }

    let deliveryBoy = await DeliveryBoy.findOne({ user: riderUser._id });
    const depositTxId = "TXN-GANGANAGAR-DEP-1000";

    const riderProfile = {
      user: riderUser._id,
      fullName: "Deepak Kumar",
      phone: riderPhone,
      email: riderEmail,
      dateOfBirth: new Date("1997-06-12"),
      serviceCity: GANGA_NAGAR_COORDS.city,
      serviceArea: "Ganga Nagar, Meerut, Uttar Pradesh 250001",
      currentAddress: {
        addressLine: "Pocket A, Ganga Nagar",
        city: GANGA_NAGAR_COORDS.city,
        state: GANGA_NAGAR_COORDS.state,
        pincode: GANGA_NAGAR_COORDS.pincode,
      },
      emergencyContact: {
        name: "Sunil Kumar",
        relationship: "Brother",
        phone: "9876599999",
      },
      vehicleDetails: {
        vehicleType: "Motorcycle",
        registrationNumber: "UP-15-AB-7890", // UP 15 is Meerut RTO code
        licenseNumber: "UP-15-2022-005432",
      },
      bankDetails: {
        accountHolderName: "Deepak Kumar",
        accountNumber: "50100432987654",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank Ganga Nagar Meerut",
        upiId: "deepak.meerut@okaxis",
      },
      documents: {
        panCard: {
          documentNumber: "ABCDE4321F",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        aadhaarCard: {
          documentNumber: "345678901234",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        drivingLicense: {
          documentNumber: "UP-15-2022-005432",
          frontUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          backUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        vehicleRc: {
          documentNumber: "UP-15-AB-7890",
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
        gateway: "Razorpay",
      },
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      adminRemarks: "Verified Ganga Nagar Meerut official delivery partner.",
      availability: "ONLINE",
      currentLocation: {
        type: "Point",
        coordinates: [GANGA_NAGAR_COORDS.longitude, GANGA_NAGAR_COORDS.latitude], // GeoJSON: [lng, lat]
      },
      lastLocationUpdatedAt: new Date(),
      metrics: {
        totalDeliveries: 35,
        rating: 4.9,
        ratingsCount: 32,
        acceptanceRate: 99,
      },
      wallet: {
        currentBalance: 450,
        totalEarned: 2400,
      },
    };

    if (!deliveryBoy) {
      deliveryBoy = await DeliveryBoy.create(riderProfile);
      console.log(`[OK] Created DeliveryBoy Profile: ${deliveryBoy.fullName} (ID: ${deliveryBoy._id})`);
    } else {
      Object.assign(deliveryBoy, riderProfile);
      await deliveryBoy.save();
      console.log(`[OK] Updated DeliveryBoy Profile: ${deliveryBoy.fullName} (ID: ${deliveryBoy._id})`);
    }

    // Ensure SecurityDepositLedger entry exists
    let depositLedger = await SecurityDepositLedger.findOne({ transactionId: depositTxId });
    if (!depositLedger) {
      depositLedger = await SecurityDepositLedger.create({
        deliveryBoy: deliveryBoy._id,
        user: riderUser._id,
        amount: 1000,
        currency: "INR",
        type: "DEPOSIT_PAYMENT",
        status: "PAID",
        paymentGateway: "Razorpay",
        transactionId: depositTxId,
        gatewayReference: "RZP-REF-GNG-998877",
        paidAt: new Date(),
      });
      console.log(`[OK] Created SecurityDepositLedger record: ₹${depositLedger.amount}`);
    } else {
      depositLedger.status = "PAID";
      await depositLedger.save();
      console.log(`[OK] SecurityDepositLedger confirmed: ₹${depositLedger.amount}`);
    }

    // =========================================================================
    // 4. SUMMARY
    // =========================================================================
    console.log("\n================================================================================");
    console.log("   ✅ GANGA NAGAR, MEERUT SEED COMPLETED SUCCESSFULLY!");
    console.log("================================================================================");
    console.log("📍 LOCATION:");
    console.log(`   • Area:        Ganga Nagar (गंगा नगर)`);
    console.log(`   • City/State:  Meerut, Uttar Pradesh, 250001`);
    console.log(`   • Coordinates: Latitude ${GANGA_NAGAR_COORDS.latitude}, Longitude ${GANGA_NAGAR_COORDS.longitude}`);
    console.log(`   • GeoJSON:     [${GANGA_NAGAR_COORDS.longitude}, ${GANGA_NAGAR_COORDS.latitude}]`);
    console.log("--------------------------------------------------------------------------------");
    console.log("🏪 VENDOR:");
    console.log(`   • Store Name:  ${storeName}`);
    console.log(`   • Email:       ${vendorEmail}`);
    console.log(`   • Phone:       ${vendorPhone}`);
    console.log(`   • Password:    ${vendorPassword}`);
    console.log(`   • Status:      APPROVED & OPEN (Radius: ${vendor.deliveryRadiusKm} km)`);
    console.log("--------------------------------------------------------------------------------");
    console.log("📦 PRODUCTS SEEDED (2):");
    seededProducts.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name} - ₹${p.price} (Original: ₹${p.originalPrice}, Stock: ${p.stock}, Unit: ${p.unit})`);
    });
    console.log("--------------------------------------------------------------------------------");
    console.log("🚴 DELIVERY BOY:");
    console.log(`   • Name:        ${deliveryBoy.fullName}`);
    console.log(`   • Email:       ${riderEmail}`);
    console.log(`   • Phone:       ${riderPhone}`);
    console.log(`   • Password:    ${riderPassword}`);
    console.log(`   • Status:      APPROVED & ONLINE`);
    console.log(`   • Deposit:     ₹1,000 PAID`);
    console.log(`   • Vehicle:     Motorcycle (${riderProfile.vehicleDetails.registrationNumber})`);
    console.log("================================================================================\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ SEEDING FAILED:", error);
    process.exit(1);
  }
}

seedGangaNagar();

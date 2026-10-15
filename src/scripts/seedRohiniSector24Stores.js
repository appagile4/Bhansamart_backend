import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Product from "../models/Product.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import SecurityDepositLedger from "../models/SecurityDepositLedger.js";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://testUser:devilkumar123@cluster0.ogsfrpj.mongodb.net/BhansaMart_backend";

// Sector 24 Rohini Delhi Coordinates: ~ 28.7208 N, 77.1042 E
const ROHINI_STORES_DATA = [
  {
    storeName: "Rohini Fresh Daily Mart",
    email: "rohini.fresh@bhansamart.com",
    phone: "9811223344",
    sellerName: "Rajesh Gupta",
    warehouseAddress: "Shop 12-14, DDA Market, Pocket 1, Sector 24, Rohini",
    city: "Delhi",
    state: "Delhi",
    pincode: "110085",
    latitude: 28.7212,
    longitude: 77.1038,
    deliveryRadiusKm: 5.0,
    categories: ["Grocery & Kitchen", "Snacks & Drinks"],
    products: [
      {
        name: "Fresh Hybrid Red Tomatoes (Rohini Farm)",
        category: "Grocery & Kitchen",
        subCategory: "Vegetables & Fruits",
        price: 45,
        originalPrice: 60,
        unit: "1 kg",
        stock: 120,
        brand: "Delhi Fresh",
        description: "Farm fresh, firm, and succulent red tomatoes sourced directly for daily cooking and salads.",
        image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=800&auto=format&fit=crop&q=80",
        tags: ["Vegetables", "Fresh", "Tomatoes", "Salad"],
      },
      {
        name: "Farm Fresh Green Capsicum / Shimla Mirch",
        category: "Grocery & Kitchen",
        subCategory: "Vegetables & Fruits",
        price: 70,
        originalPrice: 90,
        unit: "500 g",
        stock: 80,
        brand: "Delhi Fresh",
        description: "Crisp and vibrant green bell peppers perfect for fried rice, curries, and pizza toppings.",
        image: "https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=800&auto=format&fit=crop&q=80",
        tags: ["Vegetables", "Capsicum", "Fresh", "Healthy"],
      },
      {
        name: "Amul Taaza Homogenised Toned Milk",
        category: "Grocery & Kitchen",
        subCategory: "Dairy & Breakfast",
        price: 54,
        originalPrice: 56,
        unit: "1 Litre Pouch",
        stock: 150,
        brand: "Amul",
        description: "Pasteurised toned milk rich in calcium and protein. Ideal for daily tea, coffee, and cereal.",
        image: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&auto=format&fit=crop&q=80",
        tags: ["Milk", "Dairy", "Amul", "Breakfast"],
      },
      {
        name: "Amul Salted Butter Golden Paste",
        category: "Grocery & Kitchen",
        subCategory: "Dairy & Breakfast",
        price: 275,
        originalPrice: 285,
        unit: "500 g Pack",
        stock: 75,
        brand: "Amul",
        description: "Utterly butterly delicious creamy salted butter loved by every Indian home for parathas and toast.",
        image: "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=800&auto=format&fit=crop&q=80",
        tags: ["Butter", "Dairy", "Amul", "Breakfast"],
      },
    ],
  },
  {
    storeName: "Sector 24 Organic & Grocery Superstore",
    email: "sector24.organics@bhansamart.com",
    phone: "9871122334",
    sellerName: "Virender Sharma",
    warehouseAddress: "Plot 45, Main Market Road, Pocket 2, Sector 24, Rohini",
    city: "Delhi",
    state: "Delhi",
    pincode: "110085",
    latitude: 28.7225,
    longitude: 77.1055,
    deliveryRadiusKm: 7.0,
    categories: ["Grocery & Kitchen", "Atta, Rice & Dal"],
    products: [
      {
        name: "Fortune Sharbati Pure Whole Wheat Atta",
        category: "Grocery & Kitchen",
        subCategory: "Atta, Rice & Dal",
        price: 430,
        originalPrice: 475,
        unit: "10 kg Bag",
        stock: 85,
        brand: "Fortune",
        description: "Superior quality MP Sharbati wheat flour grounded with traditional chakki process for ultra-soft rotis.",
        image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&auto=format&fit=crop&q=80",
        tags: ["Atta", "Wheat", "Staples", "Roti"],
      },
      {
        name: "Daawat Rozana Gold Basmati Rice",
        category: "Grocery & Kitchen",
        subCategory: "Atta, Rice & Dal",
        price: 360,
        originalPrice: 420,
        unit: "5 kg Bag",
        stock: 90,
        brand: "Daawat",
        description: "Aromatic, long grain basmati rice suitable for daily pulao, jeera rice, and biryani feasts.",
        image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&auto=format&fit=crop&q=80",
        tags: ["Rice", "Basmati", "Daawat", "Staples"],
      },
      {
        name: "Tata Sampann High Protein Yellow Arhar Dal",
        category: "Grocery & Kitchen",
        subCategory: "Atta, Rice & Dal",
        price: 195,
        originalPrice: 220,
        unit: "1 kg Pack",
        stock: 110,
        brand: "Tata Sampann",
        description: "Unpolished, wholesome toor arhar dal rich in dietary proteins and natural authentic taste.",
        image: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format&fit=crop&q=80",
        tags: ["Dal", "Arhar", "Toor", "Protein"],
      },
      {
        name: "Fortune Kachi Ghani Mustard Oil",
        category: "Grocery & Kitchen",
        subCategory: "Oil, Ghee & Masala",
        price: 165,
        originalPrice: 190,
        unit: "1 Litre Bottle",
        stock: 140,
        brand: "Fortune",
        description: "Cold-pressed pure mustard oil with sharp natural pungency and deep authentic flavor.",
        image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&auto=format&fit=crop&q=80",
        tags: ["Oil", "Mustard", "Fortune", "Cooking"],
      },
    ],
  },
  {
    storeName: "Aggarwal Sweets & Quick Snacks Sector 24",
    email: "aggarwal.sector24@bhansamart.com",
    phone: "9899112233",
    sellerName: "Mukesh Aggarwal",
    warehouseAddress: "Near Central Park, Pocket 3, Sector 24, Rohini",
    city: "Delhi",
    state: "Delhi",
    pincode: "110085",
    latitude: 28.7198,
    longitude: 77.1025,
    deliveryRadiusKm: 4.5,
    categories: ["Snacks & Drinks", "Sweet Tooth"],
    products: [
      {
        name: "Haldiram's Desi Ghee Gulab Jamun Tin",
        category: "Gifting",
        subCategory: "Sweet Tooth",
        price: 260,
        originalPrice: 295,
        unit: "1 kg Tin",
        stock: 65,
        brand: "Haldiram's",
        description: "Soft, melt-in-the-mouth classic Indian sweet made with mawa and soaked in rich saffron cardamom syrup.",
        image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&auto=format&fit=crop&q=80",
        tags: ["Sweets", "Gulab Jamun", "Haldirams", "Dessert"],
      },
      {
        name: "Bikaji Bhujia Sev Crispy Namkeen",
        category: "Snacks & Drinks",
        subCategory: "Chips & Crisps",
        price: 120,
        originalPrice: 140,
        unit: "400 g Pack",
        stock: 130,
        brand: "Bikaji",
        description: "Authentic Bikaneri moth bean bhujia with traditional spices. Perfect companion for evening tea.",
        image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800&auto=format&fit=crop&q=80",
        tags: ["Namkeen", "Bhujia", "Snacks", "Tea Time"],
      },
      {
        name: "Lay's India's Magic Masala Potato Chips",
        category: "Snacks & Drinks",
        subCategory: "Chips & Crisps",
        price: 30,
        originalPrice: 30,
        unit: "73 g Pack",
        stock: 200,
        brand: "Lay's",
        description: "Crunchy ridge-cut potato chips seasoned with a signature blend of fiery Indian spices.",
        image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800&auto=format&fit=crop&q=80",
        tags: ["Chips", "Lays", "Masala", "Snacks"],
      },
      {
        name: "Coca-Cola Original Taste Chilled Bottle",
        category: "Snacks & Drinks",
        subCategory: "Cold Drinks & Juices",
        price: 90,
        originalPrice: 95,
        unit: "2 Litre Bottle",
        stock: 120,
        brand: "Coca-Cola",
        description: "Refreshing carbonated beverage for parties, lunch gatherings, and instant refreshment.",
        image: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&auto=format&fit=crop&q=80",
        tags: ["Cold Drink", "Cola", "Beverage", "Party"],
      },
    ],
  },
  {
    storeName: "Rohini Wellness & Stationery Hub",
    email: "rohini.wellness@bhansamart.com",
    phone: "9818822334",
    sellerName: "Praveen Bansal",
    warehouseAddress: "Commercial Complex, Block C, Sector 24, Rohini",
    city: "Delhi",
    state: "Delhi",
    pincode: "110085",
    latitude: 28.7230,
    longitude: 77.1068,
    deliveryRadiusKm: 6.0,
    categories: ["Beauty & Personal Care", "School, Office & Stationery"],
    products: [
      {
        name: "Himalaya Purifying Neem Face Wash",
        category: "Beauty & Personal Care",
        subCategory: "Bath & Body",
        price: 215,
        originalPrice: 260,
        unit: "200 ml Bottle",
        stock: 80,
        brand: "Himalaya",
        description: "Soap-free herbal formulation that gently removes excess oil, impurities, and prevents pimples.",
        image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&auto=format&fit=crop&q=80",
        tags: ["Face Wash", "Neem", "Himalaya", "Skin Care"],
      },
      {
        name: "Dettol Original Germ Protection Bathing Soap",
        category: "Beauty & Personal Care",
        subCategory: "Bath & Body",
        price: 180,
        originalPrice: 210,
        unit: "4 × 125 g Pack",
        stock: 95,
        brand: "Dettol",
        description: "Trusted germ protection soap infused with moisturizers for hygienic and healthy daily baths.",
        image: "https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?w=800&auto=format&fit=crop&q=80",
        tags: ["Soap", "Dettol", "Hygiene", "Bath"],
      },
      {
        name: "Classmate Pulse 6-Subject Spiral Notebook",
        category: "School, Office & Stationery",
        subCategory: "Notebooks & Registers",
        price: 165,
        originalPrice: 190,
        unit: "300 Pages",
        stock: 140,
        brand: "Classmate",
        description: "Premium smooth paper spiral notebook with color-coded dividers for colleges and offices.",
        image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80",
        tags: ["Notebook", "Stationery", "Classmate", "School"],
      },
      {
        name: "Parker Vector Matte Black Fountain & Ball Pen Set",
        category: "School, Office & Stationery",
        subCategory: "Pens, Pencils & Art",
        price: 520,
        originalPrice: 600,
        unit: "Combo Pack",
        stock: 50,
        brand: "Parker",
        description: "Elegant matte finish metal pens with stainless steel nib and smooth fine-point writing ink.",
        image: "https://images.unsplash.com/photo-1585336261026-7a561122a278?w=800&auto=format&fit=crop&q=80",
        tags: ["Pen", "Parker", "Luxury", "Office"],
      },
    ],
  },
];

async function seedRohiniStores() {
  console.log("================================================================================");
  console.log("   SEEDING SECTOR 24 ROHINI DELHI STORES, PRODUCTS & DELIVERY PARTNER");
  console.log("================================================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("[OK] Connected to MongoDB database.");

    let totalStoresSeeded = 0;
    let totalProductsSeeded = 0;

    for (const storeData of ROHINI_STORES_DATA) {
      console.log(`\nProcessing Store: ${storeData.storeName}...`);

      // 1. Create or Find Vendor User
      let user = await User.findOne({ email: storeData.email });
      if (!user) {
        user = await User.create({
          name: storeData.sellerName,
          email: storeData.email,
          phone: storeData.phone,
          password: "Password@123", // Hashes via userSchema pre-save
          address: storeData.warehouseAddress,
          role: "vendor",
          status: "active",
          isApproved: true,
          isEmailVerified: true,
          isActive: true,
        });
        console.log(`- Created User Account: ${user.name} (${user.email})`);
      } else {
        user.role = "vendor";
        user.status = "active";
        user.isApproved = true;
        user.isActive = true;
        await user.save();
        console.log(`- Verified Existing User Account: ${user.email}`);
      }

      // 2. Create or Update Vendor Profile with Sector 24 Rohini coordinates & radius
      let vendor = await Vendor.findOne({ userId: user._id });
      const vendorPayload = {
        userId: user._id,
        businessDetails: {
          businessName: storeData.storeName,
          businessType: "Private Limited",
          gstNumber: "07AAACB" + Math.floor(1000 + Math.random() * 9000) + "D1Z4",
          panNumber: "AAACB" + Math.floor(1000 + Math.random() * 9000) + "D",
          businessEmail: storeData.email,
          businessPhone: storeData.phone,
          registeredAddress: storeData.warehouseAddress,
          city: storeData.city,
          state: storeData.state,
          pincode: storeData.pincode,
          country: "India",
          yearEstablished: 2022,
          numberOfEmployees: 10,
          categories: storeData.categories,
          retailChannel: "Omnichannel (Store & Online Delivery)",
        },
        sellerDetails: {
          sellerName: storeData.sellerName,
          sellerEmail: storeData.email,
          sellerPhone: storeData.phone,
          address: storeData.warehouseAddress,
          city: storeData.city,
          state: storeData.state,
          pincode: storeData.pincode,
        },
        shippingLocations: {
          warehouseAddress: storeData.warehouseAddress,
          city: storeData.city,
          state: storeData.state,
          pincode: storeData.pincode,
          latitude: storeData.latitude,
          longitude: storeData.longitude,
        },
        deliveryRadiusKm: storeData.deliveryRadiusKm,
        isStoreOpen: true,
        location: {
          type: "Point",
          coordinates: [storeData.longitude, storeData.latitude], // [lng, lat]
        },
        status: "approved",
      };

      if (!vendor) {
        vendor = await Vendor.create(vendorPayload);
        console.log(`- Created Vendor Document: ${vendor.businessDetails.businessName} (Radius: ${vendor.deliveryRadiusKm} km)`);
      } else {
        Object.assign(vendor, vendorPayload);
        await vendor.save();
        console.log(`- Updated Vendor Document: ${vendor.businessDetails.businessName} (Radius: ${vendor.deliveryRadiusKm} km)`);
      }
      totalStoresSeeded++;

      // 3. Seed Products for this store
      for (const prod of storeData.products) {
        const baseSlug = String(prod.name)
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/[\s_-]+/g, "-")
          .replace(/^-+|-+$/g, "");

        const sku = `ROH-${prod.category.slice(0, 3).toUpperCase()}-${Math.floor(
          100000 + Math.random() * 900000
        )}`;

        const productData = {
          vendor: vendor._id,
          user: user._id,
          name: prod.name,
          slug: `${baseSlug}-${vendor._id.toString().slice(-4)}`,
          description: prod.description,
          shortDescription: prod.description.slice(0, 100),
          category: prod.category,
          subCategory: prod.subCategory,
          supplierName: storeData.storeName,
          brand: prod.brand,
          expirationDate: "12/2027",
          price: prod.price,
          originalPrice: prod.originalPrice,
          discountCategory: "Special Area Discount",
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
              publicId: `seed-rohini-${baseSlug}`,
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
            isNewArrival: false,
          },
          ratingsAverage: +(4.5 + Math.random() * 0.4).toFixed(1),
          ratingsCount: Math.floor(25 + Math.random() * 100),
          views: 650,
          ordersCount: 180,
          isActive: true,
          isDeleted: false,
        };

        const existingProd = await Product.findOne({
          name: prod.name,
          vendor: vendor._id,
        });

        if (existingProd) {
          await Product.findByIdAndUpdate(existingProd._id, productData);
        } else {
          await Product.create(productData);
        }
        totalProductsSeeded++;
      }
      console.log(`- Seeded ${storeData.products.length} products for ${storeData.storeName}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Seed Verified Delivery Partner Stationed in Sector 24 Rohini
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- Seeding Delivery Partner in Sector 24 Rohini ---");
    const riderEmail = "rider.rohini@bhansamart.com";
    const riderPhone = "9819988776";
    const riderPassword = "Password@123";

    let riderUser = await User.findOne({ email: riderEmail });
    if (!riderUser) {
      riderUser = await User.create({
        name: "Amit Sharma (Rohini Delivery)",
        email: riderEmail,
        phone: riderPhone,
        password: riderPassword,
        address: "Pocket 2, Sector 24, Rohini, New Delhi",
        role: "delivery_boy",
        status: "approved",
        isApproved: true,
        isActive: true,
      });
      console.log(`- Created Delivery Partner User: ${riderUser.email}`);
    } else {
      riderUser.role = "delivery_boy";
      riderUser.status = "approved";
      riderUser.isApproved = true;
      riderUser.isActive = true;
      await riderUser.save();
    }

    let deliveryBoy = await DeliveryBoy.findOne({ user: riderUser._id });
    const riderProfile = {
      user: riderUser._id,
      fullName: "Amit Sharma",
      phone: riderPhone,
      email: riderEmail,
      serviceCity: "Delhi",
      serviceArea: "Sector 24 Rohini, Delhi",
      currentAddress: {
        addressLine: "Pocket 2, Near Central Park, Sector 24, Rohini",
        city: "Delhi",
        state: "Delhi",
        pincode: "110085",
      },
      vehicleDetails: {
        vehicleType: "Motorcycle",
        registrationNumber: "DL-11-AB-4321",
        licenseNumber: "DL-2022-009876",
      },
      bankDetails: {
        accountHolderName: "Amit Sharma",
        accountNumber: "50100432109876",
        ifscCode: "HDFC0001234",
        bankName: "HDFC Bank",
        upiId: "amit.sharma@okaxis",
      },
      documents: {
        panCard: {
          documentNumber: "ABCDE1234F",
          documentUrl: "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=500",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        aadhaarCard: {
          documentNumber: "234567890123",
          documentUrl: "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=500",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        drivingLicense: {
          documentNumber: "DL-11-2022-009876",
          documentUrl: "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=500",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
        vehicleRc: {
          documentNumber: "DL-11-AB-4321",
          documentUrl: "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=500",
          status: "VERIFIED",
          verifiedAt: new Date(),
        },
      },
      securityDeposit: {
        requiredAmount: 1000,
        paidAmount: 1000,
        status: "PAID",
        paidAt: new Date(),
        transactionId: "TXN-ROHINI-DEP-1000",
        gateway: "Razorpay",
      },
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      availability: "ONLINE",
      currentLocation: {
        type: "Point",
        coordinates: [77.1042, 28.7208], // Sector 24 Rohini central coordinates
      },
      lastLocationUpdatedAt: new Date(),
    };

    if (!deliveryBoy) {
      deliveryBoy = await DeliveryBoy.create(riderProfile);
      console.log(`- Created DeliveryBoy Profile: ${deliveryBoy.fullName} (ONLINE in Sector 24 Rohini)`);
    } else {
      Object.assign(deliveryBoy, riderProfile);
      await deliveryBoy.save();
      console.log(`- Updated DeliveryBoy Profile: ${deliveryBoy.fullName} (ONLINE in Sector 24 Rohini)`);
    }

    console.log("\n================================================================================");
    console.log("✅ SEEDING COMPLETED SUCCESSFULLY!");
    console.log(`- Total Sector 24 Rohini Stores Seeded: ${totalStoresSeeded}`);
    console.log(`- Total Products Seeded: ${totalProductsSeeded}`);
    console.log("- 1 Online & Verified Delivery Partner Stationed in Sector 24 Rohini");
    console.log("================================================================================");
    console.log("\nStores Created:");
    ROHINI_STORES_DATA.forEach((s, idx) => {
      console.log(`${idx + 1}. ${s.storeName} (${s.email} / Password@123)`);
      console.log(`   Address: ${s.warehouseAddress}, Delhi 110085`);
      console.log(`   Coordinates: [Lat: ${s.latitude}, Lng: ${s.longitude}] | Radius: ${s.deliveryRadiusKm} km\n`);
    });

    console.log(`Delivery Partner:`);
    console.log(`- Amit Sharma (${riderEmail} / Password@123) | Status: ONLINE | [28.7208° N, 77.1042° E]\n`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during seeding:", error);
    process.exit(1);
  }
}

seedRohiniStores();

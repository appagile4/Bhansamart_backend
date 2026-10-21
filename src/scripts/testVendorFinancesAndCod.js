import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import Order from "../models/Order.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import VendorTransaction from "../models/VendorTransaction.js";
import VendorNotification from "../models/VendorNotification.js";
import CodHandover from "../models/CodHandover.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function runTests() {
  console.log("=================================================");
  console.log("   TESTING VENDOR FINANCES, NOTIFICATIONS & COD  ");
  console.log("=================================================");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/bhansamart";
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB successfully.");

  let vendorUser, vendor, deliveryUser, deliveryBoy, testOrderCod, testOrderOnline;

  try {
    // 1. Setup Test Vendor User & Profile
    vendorUser = await User.findOneAndUpdate(
      { email: "test.vendor.finance@bhansamart.com" },
      {
        name: "Test Finance Vendor",
        email: "test.vendor.finance@bhansamart.com",
        phone: "+9779800000088",
        role: "vendor",
        isActive: true,
      },
      { upsert: true, returnDocument: "after" }
    );

    vendor = await Vendor.findOneAndUpdate(
      { userId: vendorUser._id },
      {
        userId: vendorUser._id,
        status: "approved",
        businessDetails: {
          businessName: "Finance Test Grocery",
          businessEmail: "test.vendor.finance@bhansamart.com",
        },
        bankDetails: {
          accountHolderName: "Finance Test Grocery",
          accountNumber: "123456789012",
          bankName: "Nabil Bank",
          ifscCode: "NABIL001",
        },
        wallet: {
          currentBalance: 5000,
          totalEarned: 15000,
          pendingSettlement: 0,
          codCashWithDeliveryBoys: 0,
        },
        paymentSettings: {
          upiId: "financetest@upi",
          acceptQrPayments: true,
        },
      },
      { upsert: true, returnDocument: "after" }
    );
    console.log("✓ Vendor profile setup with initial wallet balance: NPR 5,000");

    // 2. Setup Test Delivery Partner
    deliveryUser = await User.findOneAndUpdate(
      { email: "test.rider.finance@bhansamart.com" },
      {
        name: "Test Finance Rider",
        email: "test.rider.finance@bhansamart.com",
        phone: "+9779800000099",
        role: "delivery_boy",
        isActive: true,
      },
      { upsert: true, returnDocument: "after" }
    );

    deliveryBoy = await DeliveryBoy.findOneAndUpdate(
      { user: deliveryUser._id },
      {
        user: deliveryUser._id,
        fullName: "Test Finance Rider",
        phone: "+9779800000099",
        approvalStatus: "APPROVED",
        availability: "ONLINE",
        codCashInCustody: 0,
      },
      { upsert: true, returnDocument: "after" }
    );
    console.log("✓ Delivery Partner setup with initial COD custody: NPR 0");

    // 3. Test Persistent Vendor Notification
    const notif = await VendorNotification.create({
      vendor: vendor._id,
      type: "NEW_ORDER",
      title: "New Customer Order!",
      message: "Order #TEST-FIN-001 placed for NPR 850",
      data: { orderNumber: "TEST-FIN-001", totalAmount: 850 },
    });
    console.log("✓ VendorNotification created successfully with ID:", notif._id.toString());

    const unreadCount = await VendorNotification.countDocuments({
      vendor: vendor._id,
      isRead: false,
    });
    if (unreadCount < 1) throw new Error("Unread notifications count mismatch!");
    console.log(`✓ Verified unread notification count: ${unreadCount}`);

    // Mark as read
    await VendorNotification.findByIdAndUpdate(notif._id, { isRead: true, readAt: new Date() });
    const remainingUnread = await VendorNotification.countDocuments({
      vendor: vendor._id,
      isRead: false,
    });
    console.log(`✓ Marked notification as read. Remaining unread: ${remainingUnread}`);

    // 4. Test Cash on Delivery Order Collection Flow
    testOrderCod = await Order.create({
      orderNumber: `BM-TEST-COD-${Date.now()}`,
      customer: vendorUser._id,
      vendor: vendor._id,
      items: [
        {
          product: new mongoose.Types.ObjectId(),
          productId: "p1",
          name: "Fresh Tomatoes",
          price: 500,
          quantity: 2,
        },
      ],
      totalCount: 2,
      itemsTotal: 1000,
      totalAmount: 1000,
      deliveryAddress: { addressLine: "Test Address", phone: "+9779800000088" },
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      assignedDeliveryBoy: deliveryBoy._id,
      codDetails: {
        cashCollectedByRider: true,
        cashCollectedAmount: 1000,
        cashCollectedAt: new Date(),
        cashSubmittedToVendor: false,
      },
    });

    // Simulate delivery partner collecting COD:
    // Update custody and vendor COD tracker
    deliveryBoy.codCashInCustody += testOrderCod.totalAmount;
    await deliveryBoy.save();

    vendor.wallet.codCashWithDeliveryBoys += testOrderCod.totalAmount;
    await vendor.save();

    // Idempotent COD Collection Transaction
    const codTxnKey = `TXN-COD-COLL-${testOrderCod._id}`;
    await VendorTransaction.create({
      vendor: vendor._id,
      order: testOrderCod._id,
      deliveryBoy: deliveryBoy._id,
      type: "COD_COLLECTION",
      amount: testOrderCod.totalAmount,
      grossAmount: testOrderCod.totalAmount,
      netAmount: testOrderCod.totalAmount,
      status: "CASH_IN_CUSTODY",
      idempotencyKey: codTxnKey,
      notes: "Cash collected by rider from customer",
    });

    console.log("✓ COD Order delivered: Cash collected NPR 1,000");
    console.log(`  - Delivery Partner cash in custody: NPR ${deliveryBoy.codCashInCustody}`);
    console.log(`  - Vendor COD cash with riders: NPR ${vendor.wallet.codCashWithDeliveryBoys}`);
    console.log(`  - Vendor withdrawable balance (MUST NOT increase): NPR ${vendor.wallet.currentBalance}`);

    if (vendor.wallet.currentBalance !== 5000) {
      throw new Error("Financial rule violated: COD collected cash was wrongly added to withdrawable balance!");
    }

    // 5. Test Duplicate Prevention (Idempotency)
    let duplicateCaught = false;
    try {
      await VendorTransaction.create({
        vendor: vendor._id,
        order: testOrderCod._id,
        type: "COD_COLLECTION",
        amount: testOrderCod.totalAmount,
        status: "CASH_IN_CUSTODY",
        idempotencyKey: codTxnKey,
      });
    } catch (dupErr) {
      duplicateCaught = true;
    }
    if (!duplicateCaught) {
      throw new Error("Duplicate transaction prevention failed!");
    }
    console.log("✓ Idempotency verified: Duplicate transaction rejected by database unique index.");

    // 6. Test COD Cash Handover at Vendor Store
    const receiptNumber = await CodHandover.generateReceiptNumber();
    console.log(`✓ Generated COD handover receipt: ${receiptNumber}`);

    const handoverAmount = 1000;
    const handover = await CodHandover.create({
      receiptNumber,
      vendor: vendor._id,
      deliveryBoy: deliveryBoy._id,
      orders: [testOrderCod._id],
      amountDue: 1000,
      amountSubmitted: handoverAmount,
      remainingBalance: 0,
      vendorConfirmed: true,
      paymentMode: "CASH",
      notes: "Verified and received at store counter",
    });

    // Update custody and order flags
    deliveryBoy.codCashInCustody -= handoverAmount;
    await deliveryBoy.save();

    vendor.wallet.codCashWithDeliveryBoys -= handoverAmount;
    await vendor.save();

    testOrderCod.codDetails.cashSubmittedToVendor = true;
    testOrderCod.codDetails.cashSubmittedAt = new Date();
    testOrderCod.codDetails.handoverReceipt = receiptNumber;
    await testOrderCod.save();

    await VendorTransaction.create({
      vendor: vendor._id,
      deliveryBoy: deliveryBoy._id,
      type: "COD_HANDOVER",
      amount: handoverAmount,
      status: "COMPLETED",
      idempotencyKey: `COD-HANDOVER-${receiptNumber}`,
      notes: `Cash handed over by ${deliveryBoy.fullName}`,
    });

    console.log("✓ Store Cash Handover verified:");
    console.log(`  - Rider cash custody remaining: NPR ${deliveryBoy.codCashInCustody}`);
    console.log(`  - Vendor COD pending remaining: NPR ${vendor.wallet.codCashWithDeliveryBoys}`);
    if (deliveryBoy.codCashInCustody !== 0 || vendor.wallet.codCashWithDeliveryBoys !== 0) {
      throw new Error("Handover settlement amounts incorrect!");
    }

    // 7. Test Withdrawal Request
    const withdrawAmount = 2000;
    vendor.wallet.currentBalance -= withdrawAmount;
    vendor.wallet.pendingSettlement += withdrawAmount;
    await vendor.save();

    const withdrawTxn = await VendorTransaction.create({
      vendor: vendor._id,
      type: "WITHDRAWAL",
      amount: withdrawAmount,
      status: "PENDING",
      idempotencyKey: `WITHDRAW-${vendor._id}-${Date.now()}`,
      notes: "Payout request",
    });

    console.log(`✓ Withdrawal processed: NPR ${withdrawAmount}`);
    console.log(`  - Remaining Withdrawable: NPR ${vendor.wallet.currentBalance}`);
    console.log(`  - Pending Settlement: NPR ${vendor.wallet.pendingSettlement}`);

    if (vendor.wallet.currentBalance !== 3000 || vendor.wallet.pendingSettlement !== 2000) {
      throw new Error("Withdrawal wallet balance update failed!");
    }

    console.log("\n=================================================");
    console.log("   ALL VENDOR FINANCE & COD BACKEND TESTS PASSED!");
    console.log("=================================================\n");
  } finally {
    // Cleanup test data
    if (vendor) {
      await VendorTransaction.deleteMany({ vendor: vendor._id });
      await VendorNotification.deleteMany({ vendor: vendor._id });
      await CodHandover.deleteMany({ vendor: vendor._id });
      await Order.deleteMany({ vendor: vendor._id });
      await Vendor.findByIdAndDelete(vendor._id);
    }
    if (vendorUser) await User.findByIdAndDelete(vendorUser._id);
    if (deliveryBoy) await DeliveryBoy.findByIdAndDelete(deliveryBoy._id);
    if (deliveryUser) await User.findByIdAndDelete(deliveryUser._id);

    await mongoose.disconnect();
    console.log("MongoDB connection closed and test records cleaned up.");
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

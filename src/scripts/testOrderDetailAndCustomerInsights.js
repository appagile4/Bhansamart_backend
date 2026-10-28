import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import User from "../models/User.js";
import Vendor from "../models/Vendor.js";
import DeliveryBoy from "../models/DeliveryBoy.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import DeliveryAssignment from "../models/DeliveryAssignment.js";
import DeliveryEarningsLedger from "../models/DeliveryEarningsLedger.js";
import CodHandover from "../models/CodHandover.js";
import Refund from "../models/Refund.js";

import { getOrderById } from "../controllers/orderController.js";
import { getCustomerDetailsAdmin } from "../controllers/staffAdminOperationsController.js";

async function runTestSuite() {
  console.log("=========================================================================");
  console.log("  BHANSAMART – ORDER DETAIL MODAL & CUSTOMER INSIGHTS VERIFICATION TESTS ");
  console.log("=========================================================================");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✓ Connected to Database for verification tests.\n");

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS - ${message}`);
      testsPassed++;
    } else {
      console.error(`❌ FAIL - ${message}`);
      testsFailed++;
    }
  }

  // Mock Express Request & Response helper
  function mockReqRes(user, params = {}, query = {}, body = {}) {
    let statusCode = 200;
    let responseData = null;
    let nextError = null;

    const req = {
      user,
      params,
      query,
      body,
    };

    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    const next = (err) => {
      nextError = err;
    };

    return {
      req,
      res,
      next,
      getStatus: () => (nextError ? nextError.statusCode || 500 : statusCode),
      getData: () => responseData,
      getError: () => nextError,
    };
  }

  try {
    // ── Setup Fixtures ───────────────────────────────────────────────────
    const timestamp = Date.now();

    // 1. Super Admin
    const superAdminUser = await User.create({
      name: "Chief SuperAdmin",
      email: `super_${timestamp}@bhansamart.com`,
      password: "hashedpassword123",
      role: "superadmin",
    });

    // 2. Vendor A
    const vendorAUser = await User.create({
      name: "Vendor Owner A",
      email: `vendor_a_${timestamp}@test.com`,
      password: "hashedpassword123",
      role: "vendor",
    });

    const vendorA = await Vendor.create({
      userId: vendorAUser._id,
      businessDetails: {
        businessName: "Super Bakery & Cafe",
        businessEmail: "bakery@test.com",
        businessPhone: "+9779811111111",
      },
      shippingLocations: { warehouseAddress: "Kathmandu Central Warehouse" },
      status: "approved",
      wallet: { currentBalance: 500, codCashWithDeliveryBoys: 0 },
    });

    // 3. Vendor B
    const vendorBUser = await User.create({
      name: "Vendor Owner B",
      email: `vendor_b_${timestamp}@test.com`,
      password: "hashedpassword123",
      role: "vendor",
    });

    const vendorB = await Vendor.create({
      userId: vendorBUser._id,
      businessDetails: {
        businessName: "Himalayan Tech Gear",
        businessEmail: "tech@test.com",
        businessPhone: "+9779822222222",
      },
      status: "approved",
      wallet: { currentBalance: 1000, codCashWithDeliveryBoys: 0 },
    });

    // 4. Staff Admin Assigned ONLY to Vendor A
    const staffAdminUser = await User.create({
      name: "Staff Admin Alpha",
      email: `staff_${timestamp}@bhansamart.com`,
      password: "hashedpassword123",
      role: "admin",
      assignedVendors: [vendorA._id],
    });

    // 5. Staff Admin Assigned ONLY to Vendor B
    const staffAdminBUser = await User.create({
      name: "Staff Admin Beta",
      email: `staff_b_${timestamp}@bhansamart.com`,
      password: "hashedpassword123",
      role: "admin",
      assignedVendors: [vendorB._id],
    });

    // 6. Customer User
    const customer = await User.create({
      name: "Rajesh Customer",
      email: `customer_${timestamp}@test.com`,
      phone: "+9779841234567",
      password: "hashedpassword123",
      role: "customer",
      rewardPoints: 120,
    });

    // 7. Delivery Boy
    const riderUser = await User.create({
      name: "Karan Delivery Boy",
      email: `rider_${timestamp}@test.com`,
      phone: "+9779851987654",
      password: "hashedpassword123",
      role: "delivery_boy",
    });

    const deliveryBoy = await DeliveryBoy.create({
      user: riderUser._id,
      fullName: "Karan Delivery Boy",
      phone: "+9779851987654",
      wallet: { currentBalance: 0, totalEarned: 0 },
      codCashInCustody: 0,
      isAvailable: true,
    });

    // 8. Product for Vendor A
    const productA = await Product.create({
      name: "Chocolate Croissant",
      slug: `chocolate-croissant-${timestamp}`,
      price: 150,
      vendor: vendorA._id,
      stock: 50,
      category: "Bakery",
    });

    // 9. Completed COD Order 1 (Customer -> Vendor A, Delivered by Karan)
    const order1 = await Order.create({
      orderNumber: `ORD-TEST-1-${timestamp}`,
      customer: customer._id,
      vendor: vendorA._id,
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          price: productA.price,
          quantity: 2,
        },
      ],
      totalCount: 2,
      itemsTotal: 300,
      totalAmount: 300,
      deliveryAddress: {
        addressLine: "Baluwatar Road 4",
        city: "Kathmandu",
        phone: "+9779841234567",
      },
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      deliveredAt: new Date(Date.now() - 3600000),
      assignedDeliveryBoy: deliveryBoy._id,
      codDetails: {
        status: "VENDOR_CONFIRMED",
        amountDue: 300,
        amountCollected: 300,
        amountHandedOver: 300,
        vendorConfirmed: true,
        vendorConfirmedAt: new Date(),
        handoverReceipt: `RCP-${timestamp}`,
      },
      deliveryEarnings: {
        basePay: 30,
        distancePay: 0,
        tip: 0,
        total: 30,
      },
    });

    // Create Assignment for Order 1
    const assignment1 = await DeliveryAssignment.create({
      order: order1._id,
      deliveryBoy: deliveryBoy._id,
      vendor: vendorA._id,
      status: "COMPLETED",
      assignedAt: new Date(Date.now() - 7200000),
      acceptedAt: new Date(Date.now() - 7100000),
      completedAt: new Date(Date.now() - 3600000),
      expiresAt: new Date(Date.now() + 120000),
    });

    // Delivery Earnings Ledger for Order 1
    await DeliveryEarningsLedger.create({
      deliveryBoy: deliveryBoy._id,
      order: order1._id,
      deliveryAssignment: assignment1._id,
      basePay: 30,
      totalEarnings: 30,
      earningType: "COD_DELIVERY",
      paymentMethod: "Cash on delivery",
      settlementStatus: "SETTLED",
      idempotencyKey: `EARN-${order1._id}`,
    });

    // 10. Completed COD Order 2 (Customer -> Vendor A, with a Refund claim)
    const order2 = await Order.create({
      orderNumber: `ORD-TEST-2-${timestamp}`,
      customer: customer._id,
      vendor: vendorA._id,
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: productA.name,
          price: productA.price,
          quantity: 1,
        },
      ],
      totalCount: 1,
      itemsTotal: 150,
      totalAmount: 150,
      deliveryAddress: {
        addressLine: "Baluwatar Road 4",
        city: "Kathmandu",
        phone: "+9779841234567",
      },
      paymentMethod: "Cash on delivery",
      paymentStatus: "paid",
      orderStatus: "DELIVERED",
      deliveredAt: new Date(),
      assignedDeliveryBoy: deliveryBoy._id,
      codDetails: {
        status: "CASH_COLLECTED",
        amountDue: 150,
        amountCollected: 150,
        amountHandedOver: 0,
        vendorConfirmed: false,
      },
      refundStatus: "APPROVED",
    });

    // Refund for Order 2
    const refund2 = await Refund.create({
      refundNumber: `REF-${timestamp}`,
      order: order2._id,
      orderNumber: order2.orderNumber,
      customer: customer._id,
      vendor: vendorA._id,
      amount: 150,
      totalAmount: 150,
      reason: "Damaged pastry packaging",
      status: "COMPLETED",
      isVendorFunded: true,
      customerPayoutDetails: {
        method: "UPI",
        upiId: "rajesh.customer@okhdfcbank",
        accountNumber: "987654321098",
      },
      vendorPaymentDetails: {
        paymentMethod: "UPI",
        transactionReference: "UPI-REFUND-999888",
        paidAt: new Date(),
        confirmedByVendor: true,
        notes: "Direct UPI refund to customer",
      },
    });

    // 11. Unassigned Order 3 (Vendor B)
    const order3Unassigned = await Order.create({
      orderNumber: `ORD-TEST-3-UNASSIGNED-${timestamp}`,
      customer: customer._id,
      vendor: vendorB._id,
      items: [
        {
          product: productA._id,
          productId: productA._id.toString(),
          name: "Wireless Mouse",
          price: 500,
          quantity: 1,
        },
      ],
      totalCount: 1,
      itemsTotal: 500,
      totalAmount: 500,
      deliveryAddress: {
        addressLine: "Thamel Marg",
        city: "Kathmandu",
        phone: "+9779841234567",
      },
      paymentMethod: "Online Payment",
      paymentStatus: "paid",
      orderStatus: "PLACED",
      assignedDeliveryBoy: null,
    });

    // =========================================================================
    // TEST 1: Open Order Details as Super Admin (Full Backend Response)
    // =========================================================================
    const reqRes1 = mockReqRes(superAdminUser, { id: order1._id.toString() });
    await getOrderById(reqRes1.req, reqRes1.res, reqRes1.next);
    const data1 = reqRes1.getData()?.data;

    assert(
      reqRes1.getStatus() === 200 && data1 && data1.orderNumber === order1.orderNumber,
      "[Test 1] Super Admin fetches complete order details successfully"
    );

    // =========================================================================
    // TEST 2: Customer Data & Lifetime Insights Included
    // =========================================================================
    assert(
      data1.customer &&
      data1.customer.name === customer.name &&
      data1.customer.email === customer.email &&
      data1.customerInsights &&
      data1.customerInsights.totalCompletedOrders >= 2 &&
      data1.customerInsights.totalCompletedSpending >= 450,
      `[Test 2] Customer profile and lifetime insights match authoritative DB data (Orders: ${data1?.customerInsights?.totalCompletedOrders}, Spending: NPR ${data1?.customerInsights?.totalCompletedSpending})`
    );

    // =========================================================================
    // TEST 3: Vendor Details & Product Attribution
    // =========================================================================
    assert(
      data1.vendor &&
      data1.vendor.businessDetails?.businessName === "Super Bakery & Cafe" &&
      data1.items?.length === 1 &&
      data1.items[0].name === "Chocolate Croissant",
      "[Test 3] Vendor business details and product items accurately returned"
    );

    // =========================================================================
    // TEST 4: Delivery Partner & Assignment Details
    // =========================================================================
    assert(
      data1.assignedDeliveryBoy &&
      data1.assignedDeliveryBoy.fullName === "Karan Delivery Boy" &&
      data1.deliveryAssignments?.length > 0 &&
      data1.deliveryEarning === 30,
      `[Test 4] Delivery partner, assignment history, and ₹30 earning linked (Earning: ₹${data1?.deliveryEarning})`
    );

    // =========================================================================
    // TEST 5: COD Tracking & Handover Details
    // =========================================================================
    assert(
      data1.codTracking &&
      data1.codTracking.amountDue === 300 &&
      data1.codTracking.amountCollected === 300 &&
      data1.codTracking.vendorConfirmed === true &&
      data1.codTracking.handoverReceipt?.startsWith("RCP-"),
      "[Test 5] COD amount due, cash collected, and store handover receipt verified"
    );

    // =========================================================================
    // TEST 6: Unassigned Order displays assignedDeliveryBoy as null
    // =========================================================================
    const reqResUnassigned = mockReqRes(superAdminUser, { id: order3Unassigned._id.toString() });
    await getOrderById(reqResUnassigned.req, reqResUnassigned.res, reqResUnassigned.next);
    const dataUnassigned = reqResUnassigned.getData()?.data;

    assert(
      dataUnassigned && dataUnassigned.assignedDeliveryBoy === null,
      "[Test 6] Order without delivery boy returns assignedDeliveryBoy as null (Displays 'Not Assigned')"
    );

    // =========================================================================
    // TEST 7: Order with Return/Refund includes masked payout & details
    // =========================================================================
    const reqResRefund = mockReqRes(superAdminUser, { id: order2._id.toString() });
    await getOrderById(reqResRefund.req, reqResRefund.res, reqResRefund.next);
    const dataRefund = reqResRefund.getData()?.data;

    const refundEntry = dataRefund?.refunds?.[0];
    assert(
      dataRefund &&
      dataRefund.refunds?.length === 1 &&
      refundEntry.amount === 150 &&
      refundEntry.customerPayoutDetails?.upiId?.includes("***") &&
      refundEntry.vendorPaymentDetails?.transactionReference === "UPI-REFUND-999888",
      `[Test 7] Refund claim details included with masked customer payout details (Masked UPI: ${refundEntry?.customerPayoutDetails?.upiId})`
    );

    // =========================================================================
    // TEST 8: Order with NO refunds returns empty array (no fabricated claims)
    // =========================================================================
    assert(
      data1.refunds && data1.refunds.length === 0,
      "[Test 8] Order with no refund requests returns empty refunds array (No fabricated claims)"
    );

    // =========================================================================
    // TEST 9: Staff Admin Scope Check - Access Permitted for Assigned Vendor
    // =========================================================================
    const reqResStaffAllowed = mockReqRes(staffAdminUser, { id: order1._id.toString() });
    await getOrderById(reqResStaffAllowed.req, reqResStaffAllowed.res, reqResStaffAllowed.next);

    assert(
      reqResStaffAllowed.getStatus() === 200 && reqResStaffAllowed.getData()?.success === true,
      "[Test 9] Staff Admin successfully accesses order belonging to assigned Vendor A"
    );

    // =========================================================================
    // TEST 10: Staff Admin Scope Check - Access BLOCKED (403) for Unassigned Vendor
    // =========================================================================
    const reqResStaffBlocked = mockReqRes(staffAdminUser, { id: order3Unassigned._id.toString() });
    await getOrderById(reqResStaffBlocked.req, reqResStaffBlocked.res, reqResStaffBlocked.next);

    assert(
      reqResStaffBlocked.getStatus() === 403,
      `[Test 10] Staff Admin blocked with 403 from accessing order belonging to unassigned Vendor B (Status: ${reqResStaffBlocked.getStatus()})`
    );

    // =========================================================================
    // TEST 11: Customer Details Endpoint - Super Admin Platform-Wide Insights
    // =========================================================================
    const reqResCustSuper = mockReqRes(superAdminUser, { id: customer._id.toString() });
    await getCustomerDetailsAdmin(reqResCustSuper.req, reqResCustSuper.res, reqResCustSuper.next);
    const custSuperData = reqResCustSuper.getData()?.data;

    assert(
      reqResCustSuper.getStatus() === 200 &&
      custSuperData &&
      custSuperData.customer.name === customer.name &&
      custSuperData.metrics.totalOrders >= 3 &&
      custSuperData.metrics.completedOrders >= 2 &&
      custSuperData.mostPurchasedProducts?.length > 0 &&
      custSuperData.vendorSpendingSummary?.length >= 2,
      `[Test 11] Super Admin views complete customer insights across all platform vendors (Orders: ${custSuperData?.metrics?.totalOrders}, Stores: ${custSuperData?.vendorSpendingSummary?.length})`
    );

    // =========================================================================
    // TEST 12: Customer Details Endpoint - Staff Admin Scoped Insights
    // =========================================================================
    const reqResCustStaff = mockReqRes(staffAdminUser, { id: customer._id.toString() });
    await getCustomerDetailsAdmin(reqResCustStaff.req, reqResCustStaff.res, reqResCustStaff.next);
    const custStaffData = reqResCustStaff.getData()?.data;

    // Staff Admin A only sees Vendor A's orders (2 orders, not order 3)
    assert(
      reqResCustStaff.getStatus() === 200 &&
      custStaffData &&
      custStaffData.orders.every((o) => (o.vendor._id || o.vendor).toString() === vendorA._id.toString()) &&
      custStaffData.vendorSpendingSummary.every((v) => v.vendorId === vendorA._id.toString()),
      "[Test 12] Staff Admin only receives customer purchase insights scoped to assigned Vendor A"
    );

    // =========================================================================
    // TEST 13: Staff Admin Beta (Vendor B only) accessing Customer with no Vendor B completed orders
    // =========================================================================
    // Create customer with orders strictly at Vendor A
    const customerStrictA = await User.create({
      name: "Strict Vendor A Customer",
      email: `strict_a_${timestamp}@test.com`,
      password: "hashedpassword123",
      role: "customer",
    });
    await Order.create({
      orderNumber: `ORD-STRICT-A-${timestamp}`,
      customer: customerStrictA._id,
      vendor: vendorA._id,
      items: [{ product: productA._id, productId: "P1", name: "Bread", price: 100, quantity: 1 }],
      totalCount: 1,
      itemsTotal: 100,
      totalAmount: 100,
      deliveryAddress: { addressLine: "Apt 1", city: "Ktm", phone: "123" },
      orderStatus: "DELIVERED",
    });

    const reqResStaffBForbidden = mockReqRes(staffAdminBUser, { id: customerStrictA._id.toString() });
    await getCustomerDetailsAdmin(reqResStaffBForbidden.req, reqResStaffBForbidden.res, reqResStaffBForbidden.next);

    assert(
      reqResStaffBForbidden.getStatus() === 403,
      `[Test 13] Staff Admin Beta blocked (403) from customer who has zero orders with assigned Vendor B (Status: ${reqResStaffBForbidden.getStatus()})`
    );

    // =========================================================================
    // TEST 14: Customer Navigation ID Validity
    // =========================================================================
    assert(
      data1.customer?._id && mongoose.Types.ObjectId.isValid(data1.customer._id),
      `[Test 14] Customer ID in order detail modal is valid ObjectId for navigation route /customerdetails/:customerId (${data1.customer?._id})`
    );

    // =========================================================================
    // CLEANUP
    // =========================================================================
    await Promise.all([
      User.deleteMany({ _id: { $in: [superAdminUser._id, vendorAUser._id, vendorBUser._id, staffAdminUser._id, staffAdminBUser._id, customer._id, riderUser._id, customerStrictA._id] } }),
      Vendor.deleteMany({ _id: { $in: [vendorA._id, vendorB._id] } }),
      DeliveryBoy.deleteMany({ _id: deliveryBoy._id }),
      Product.deleteMany({ _id: productA._id }),
      Order.deleteMany({ _id: { $in: [order1._id, order2._id, order3Unassigned._id] } }),
      DeliveryAssignment.deleteMany({ order: { $in: [order1._id, order2._id, order3Unassigned._id] } }),
      DeliveryEarningsLedger.deleteMany({ order: { $in: [order1._id, order2._id] } }),
      Refund.deleteMany({ _id: refund2._id }),
    ]);

    console.log("\n✓ Test fixtures successfully cleaned up.");

  } catch (err) {
    console.error("Test execution failed with unexpected error:", err);
    testsFailed++;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from Database.");
  }

  console.log("\n=========================================================================");
  console.log(`TEST RUN FINISHED: ${testsPassed} PASSED | ${testsFailed} FAILED`);
  console.log("=========================================================================");
}

runTestSuite();

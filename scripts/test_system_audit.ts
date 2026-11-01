/**
 * FMP Supermart - Comprehensive System Audit & Verification Script
 * Tests all modules end-to-end against real PostgreSQL database and Express API
 */

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  step: string;
  module: string;
  status: 'PASSED' | 'FAILED';
  details: string;
}

const results: TestResult[] = [];

function recordResult(module: string, step: string, status: 'PASSED' | 'FAILED', details: string) {
  results.push({ module, step, status, details });
  console.log(`[${status}] [${module}] ${step}: ${details}`);
}

async function runAudit() {
  console.log('====================================================');
  console.log('STARTING FMP SUPERMART COMPLETE SYSTEM AUDIT & E2E TESTS');
  console.log('====================================================\n');

  const timestamp = Date.now().toString().slice(-6);
  const testCustomerPhone = `9822${timestamp}`;
  const testCustomerPassword = 'Password@123';
  const testCustomerName = `Audit Customer ${timestamp}`;
  const testCustomerAddress = 'Shop 4, Gandhi Chowk, Karanja Lad, 444105';

  const testRiderPhone = `9733${timestamp}`;
  const testRiderPassword = 'RiderPass@123';
  const testRiderName = `Audit Rider ${timestamp}`;

  let customerToken = '';
  let adminToken = '';
  let riderToken = '';
  let customerUser: any = null;
  let adminUser: any = null;
  let createdRider: any = null;
  let placedOrderId: number = 0;
  let placedOrderOtp: string = '';
  let testProductId: number = 0;
  let initialStock: number = 0;

  // ----------------------------------------------------
  // MODULE 1: CUSTOMER REGISTRATION & AUTHENTICATION
  // ----------------------------------------------------
  try {
    // 1.1 Register Customer
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testCustomerName,
        phone: testCustomerPhone,
        password: testCustomerPassword,
        address: testCustomerAddress,
        landmark: 'Near Tower',
        email: `customer${timestamp}@example.com`
      })
    });

    const regData = await regRes.json();
    if (regRes.ok && regData.token && regData.user?.id) {
      customerUser = regData.user;
      customerToken = regData.token;
      recordResult('CUSTOMER', 'Registration in PostgreSQL', 'PASSED', `User created with ID ${customerUser.id}, status: ${customerUser.is_active}, phone: ${customerUser.phone}`);
    } else {
      recordResult('CUSTOMER', 'Registration in PostgreSQL', 'FAILED', `Registration failed: ${JSON.stringify(regData)}`);
    }

    // 1.2 Customer Login with registered mobile and password
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testCustomerPhone,
        password: testCustomerPassword
      })
    });

    const loginData = await loginRes.json();
    if (loginRes.ok && loginData.token && loginData.user?.id === customerUser.id) {
      customerToken = loginData.token;
      recordResult('CUSTOMER', 'Login with same mobile & password', 'PASSED', `Logged in as ID ${loginData.user.id}, role: ${loginData.user.role}`);
    } else {
      recordResult('CUSTOMER', 'Login with same mobile & password', 'FAILED', `Login failed: ${JSON.stringify(loginData)}`);
    }

    // 1.3 Verify /api/auth/me session
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const meData = await meRes.json();
    if (meRes.ok && meData.user?.id === customerUser.id) {
      recordResult('CUSTOMER', 'Session Validation (/api/auth/me)', 'PASSED', `Session active for customer ${meData.user.name}`);
    } else {
      recordResult('CUSTOMER', 'Session Validation (/api/auth/me)', 'FAILED', `Session verification failed: ${JSON.stringify(meData)}`);
    }

    // 1.4 Customer Profile & Address Update
    const updatedAddress = 'Flat 202, Shrinath Heights, Karanja Lad, 444105';
    const profileRes = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        name: `${testCustomerName} Updated`,
        address: updatedAddress,
        landmark: 'Opp Civil Hospital',
        email: `updated${timestamp}@example.com`
      })
    });

    const profileData = await profileRes.json();
    if (profileRes.ok && profileData.user?.address === updatedAddress) {
      recordResult('CUSTOMER', 'Profile & Saved Address Update in PostgreSQL', 'PASSED', `Address updated to: ${profileData.user.address}`);
    } else {
      recordResult('CUSTOMER', 'Profile & Saved Address Update in PostgreSQL', 'FAILED', `Profile update failed: ${JSON.stringify(profileData)}`);
    }

  } catch (err: any) {
    recordResult('CUSTOMER', 'Auth Lifecycle', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 2: PRODUCT CATALOG & INVENTORY INSPECTION
  // ----------------------------------------------------
  try {
    const prodRes = await fetch(`${BASE_URL}/api/products`);
    const products = await prodRes.json();
    if (Array.isArray(products) && products.length > 0) {
      const activeProd = products.find(p => p.stock > 10) || products[0];
      testProductId = activeProd.id;
      initialStock = activeProd.stock;
      recordResult('INVENTORY', 'Catalog & Availability', 'PASSED', `Found ${products.length} products. Selected Test Product ID ${testProductId} (${activeProd.name}) with current stock: ${initialStock}`);
    } else {
      recordResult('INVENTORY', 'Catalog & Availability', 'FAILED', 'No products found');
    }
  } catch (err: any) {
    recordResult('INVENTORY', 'Catalog & Availability', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 3: ORDER CREATION (COD CHECKOUT)
  // ----------------------------------------------------
  try {
    const orderPayload = {
      items: [
        {
          product_id: testProductId,
          quantity: 2
        }
      ],
      delivery_address: 'Flat 202, Shrinath Heights, Karanja Lad, 444105',
      landmark: 'Near Tower',
      pincode: '444105',
      tip_amount: 10
    };

    const orderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify(orderPayload)
    });

    const orderData = await orderRes.json();
    if (orderRes.ok && orderData.order?.id) {
      placedOrderId = orderData.order.id;
      // In PostgreSQL, fetch order details to see delivery_otp from customer view
      placedOrderOtp = orderData.order.delivery_otp;
      recordResult('ORDERS', 'COD Order Placement & Customer OTP', 'PASSED', `Order #${placedOrderId} (${orderData.order.order_number}) created with OTP ${placedOrderOtp}, Status: ${orderData.order.status}, Total Amount: ₹${orderData.order.total_amount}`);
    } else {
      recordResult('ORDERS', 'COD Order Placement & Customer OTP', 'FAILED', `Order placement failed: ${JSON.stringify(orderData)}`);
    }

    // Verify Inventory reduction in DB
    const prodCheckRes = await fetch(`${BASE_URL}/api/products`);
    const prodCheckData = await prodCheckRes.json();
    const checkedProd = prodCheckData.find((p: any) => p.id === testProductId);
    if (checkedProd && checkedProd.stock === initialStock - 2) {
      recordResult('INVENTORY', 'Atomic Stock Deduction on Order Place', 'PASSED', `Product stock reduced from ${initialStock} to ${checkedProd.stock} (-2 qty)`);
    } else {
      recordResult('INVENTORY', 'Atomic Stock Deduction on Order Place', 'FAILED', `Stock mismatch: expected ${initialStock - 2}, got ${checkedProd?.stock}`);
    }

    // Verify Customer order history
    const historyRes = await fetch(`${BASE_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const historyData = await historyRes.json();
    const hasOrder = Array.isArray(historyData) && historyData.some((o: any) => o.id === placedOrderId);
    recordResult('CUSTOMER', 'Order History & Tracking Query', hasOrder ? 'PASSED' : 'FAILED', `Found placed order in customer order history list (Total customer orders: ${historyData.length})`);

    // Verify Customer received placement notification
    const custNotifRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const custNotifs = await custNotifRes.json();
    const placementNotif = Array.isArray(custNotifs) && custNotifs.some((n: any) => n.order_id === placedOrderId || n.message?.includes(String(placedOrderId)));
    recordResult('NOTIFICATIONS', 'Customer Order Placement Notification', placementNotif ? 'PASSED' : 'FAILED', `Order confirmation notification logged with timestamp`);

  } catch (err: any) {
    recordResult('ORDERS', 'Order Creation Flow', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 4: ADMIN LOGIN & ORDER MANAGEMENT
  // ----------------------------------------------------
  try {
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9699925206',
        password: 'test@12345'
      })
    });

    const adminLoginData = await adminLoginRes.json();
    if (adminLoginRes.ok && adminLoginData.user?.role === 'admin') {
      adminUser = adminLoginData.user;
      adminToken = adminLoginData.token;
      recordResult('ADMIN', 'Admin Authentication & Role Gate', 'PASSED', `Admin authenticated: ID ${adminUser.id}, Role: ${adminUser.role}`);
    } else {
      recordResult('ADMIN', 'Admin Authentication & Role Gate', 'FAILED', `Admin login failed: ${JSON.stringify(adminLoginData)}`);
    }

    // Admin Dashboard Stats
    const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const statsData = await statsRes.json();
    if (statsRes.ok && statsData.orders) {
      recordResult('ADMIN', 'Dashboard Real PostgreSQL Stats', 'PASSED', `Total Orders: ${statsData.orders.total_orders}, Placed: ${statsData.orders.placed_count}, Delivered: ${statsData.orders.delivered_count}`);
    } else {
      recordResult('ADMIN', 'Dashboard Real PostgreSQL Stats', 'FAILED', `Failed to retrieve admin stats: ${JSON.stringify(statsData)}`);
    }

    // Admin View Orders
    const adminOrdersRes = await fetch(`${BASE_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminOrders = await adminOrdersRes.json();
    const foundAdminOrder = Array.isArray(adminOrders) && adminOrders.find((o: any) => o.id === placedOrderId);
    if (foundAdminOrder) {
      recordResult('ADMIN', 'Admin Order Visibility', 'PASSED', `Order #${placedOrderId} visible to admin with customer details: ${foundAdminOrder.customer_name}, ${foundAdminOrder.customer_phone}`);
    } else {
      recordResult('ADMIN', 'Admin Order Visibility', 'FAILED', `Order #${placedOrderId} not found in admin orders`);
    }

    // Admin Notification Check
    const adminNotifsRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminNotifs = await adminNotifsRes.json();
    const adminHasOrderAlert = Array.isArray(adminNotifs) && adminNotifs.some((n: any) => n.order_id === placedOrderId || n.title?.includes('New Order') || n.message?.includes(String(placedOrderId)));
    recordResult('NOTIFICATIONS', 'Admin Instant Order Alert in PostgreSQL', adminHasOrderAlert ? 'PASSED' : 'FAILED', `Admin received instant database notification for order #${placedOrderId}`);

    // Admin Creates Delivery Partner Account
    const riderCreateRes = await fetch(`${BASE_URL}/api/admin/riders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        name: testRiderName,
        phone: testRiderPhone,
        password: testRiderPassword,
        address: 'Station Road, Karanja Lad'
      })
    });

    const riderCreateData = await riderCreateRes.json();
    if (riderCreateRes.ok && riderCreateData.rider?.id) {
      createdRider = riderCreateData.rider;
      recordResult('ADMIN', 'Admin Creates Delivery Partner Account', 'PASSED', `Rider account created: ID ${createdRider.id}, Phone: ${createdRider.phone}, Name: ${createdRider.name}`);
    } else {
      recordResult('ADMIN', 'Admin Creates Delivery Partner Account', 'FAILED', `Failed creating rider: ${JSON.stringify(riderCreateData)}`);
    }

    // Admin Assigns Order to the Created Rider
    if (createdRider?.id && placedOrderId) {
      const assignRes = await fetch(`${BASE_URL}/api/orders/${placedOrderId}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: createdRider.id })
      });

      const assignData = await assignRes.json();
      const assignedRiderId = assignData.order ? assignData.order.rider_id : assignData.rider_id;
      if (assignRes.ok && assignedRiderId === createdRider.id) {
        recordResult('ORDERS', 'Admin Assigns Order to Rider', 'PASSED', `Order #${placedOrderId} assigned to Rider ID ${createdRider.id} (${createdRider.name})`);
      } else {
        recordResult('ORDERS', 'Admin Assigns Order to Rider', 'FAILED', `Failed assigning order: ${JSON.stringify(assignData)}`);
      }
    }

    // Admin Dispatches Order
    if (placedOrderId) {
      const dispatchRes = await fetch(`${BASE_URL}/api/orders/${placedOrderId}/dispatch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const dispatchData = await dispatchRes.json();
      if (dispatchRes.ok && dispatchData.order?.status === 'dispatched') {
        placedOrderOtp = dispatchData.order.delivery_otp;
        recordResult('ADMIN', 'Order Dispatch & OTP Generation', 'PASSED', `Order #${placedOrderId} marked dispatched. Customer Delivery OTP: ${placedOrderOtp}`);
      } else {
        recordResult('ADMIN', 'Order Dispatch & OTP Generation', 'FAILED', `Dispatch failed: ${JSON.stringify(dispatchData)}`);
      }
    }

  } catch (err: any) {
    recordResult('ADMIN', 'Admin Operations', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 5: DELIVERY PARTNER OPERATIONS & OTP VERIFICATION
  // ----------------------------------------------------
  try {
    // 5.1 Rider Login with Admin-Created Credentials
    const riderLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testRiderPhone,
        password: testRiderPassword
      })
    });

    const riderLoginData = await riderLoginRes.json();
    if (riderLoginRes.ok && riderLoginData.user?.role === 'rider') {
      riderToken = riderLoginData.token;
      recordResult('DELIVERY_PARTNER', 'Rider Login with Assigned Credentials', 'PASSED', `Rider authenticated: ID ${riderLoginData.user.id}, Role: ${riderLoginData.user.role}`);
    } else {
      recordResult('DELIVERY_PARTNER', 'Rider Login with Assigned Credentials', 'FAILED', `Rider login failed: ${JSON.stringify(riderLoginData)}`);
    }

    // 5.2 Rider Views Assigned Orders (Isolation: rider only sees orders assigned to them)
    const riderOrdersRes = await fetch(`${BASE_URL}/api/rider/assigned-orders`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const riderOrders = await riderOrdersRes.json();
    const assignedToMe = Array.isArray(riderOrders) && riderOrders.find((o: any) => o.id === placedOrderId);
    if (assignedToMe) {
      // Security verify: delivery_otp MUST NOT be in rider payload
      const otpExposed = assignedToMe.delivery_otp !== undefined;
      recordResult('DELIVERY_PARTNER', 'Rider Assigned Orders Query & OTP Isolation', !otpExposed ? 'PASSED' : 'FAILED', `Order #${placedOrderId} visible to rider. Delivery OTP hidden from rider: ${!otpExposed}`);
    } else {
      recordResult('DELIVERY_PARTNER', 'Rider Assigned Orders Query & OTP Isolation', 'FAILED', `Assigned order not found in rider list`);
    }

    // 5.3 Negative Test: Invalid OTP Verification
    const wrongOtpRes = await fetch(`${BASE_URL}/api/rider/orders/${placedOrderId}/verify-otp-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ otp: '0000' })
    });
    const wrongOtpData = await wrongOtpRes.json();
    if (wrongOtpRes.status === 400 && wrongOtpData.error?.toLowerCase().includes('otp')) {
      recordResult('SECURITY', 'Incorrect OTP Rejection', 'PASSED', `Correctly rejected invalid OTP '0000' with 400 error`);
    } else {
      recordResult('SECURITY', 'Incorrect OTP Rejection', 'FAILED', `Unexpected response for invalid OTP: ${JSON.stringify(wrongOtpData)}`);
    }

    // 5.4 Successful OTP Delivery & COD Collection
    const deliverRes = await fetch(`${BASE_URL}/api/rider/orders/${placedOrderId}/verify-otp-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ otp: placedOrderOtp })
    });

    const deliverData = await deliverRes.json();
    if (deliverRes.ok && deliverData.order?.status === 'delivered' && deliverData.order?.cod_collected === true) {
      recordResult('DELIVERY_PARTNER', 'OTP Verified Delivery & COD Collection', 'PASSED', `Order #${placedOrderId} delivered after valid OTP ${placedOrderOtp}. cod_collected = TRUE`);
    } else {
      recordResult('DELIVERY_PARTNER', 'OTP Verified Delivery & COD Collection', 'FAILED', `Delivery completion failed: ${JSON.stringify(deliverData)}`);
    }

    // 5.5 Verify Rider COD Summary
    const codSummaryRes = await fetch(`${BASE_URL}/api/rider/cod-summary`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const codSummary = await codSummaryRes.json();
    const cashInHand = Number(codSummary.summary?.cash_in_hand ?? codSummary.summary?.today_cash_in_hand ?? 0);
    if (codSummaryRes.ok && cashInHand >= 150) {
      recordResult('DELIVERY_PARTNER', 'Rider COD Summary & Cash-in-Hand', 'PASSED', `Cash In Hand: ₹${cashInHand}, Collected Orders: ${codSummary.summary?.total_collected_orders}`);
    } else {
      recordResult('DELIVERY_PARTNER', 'Rider COD Summary & Cash-in-Hand', 'FAILED', `COD summary verification failed: ${JSON.stringify(codSummary)}`);
    }

    // 5.6 Verify Delivery Confirmation Notification to Customer
    const custPostDelivNotifs = await (await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    })).json();
    const deliveredNotif = Array.isArray(custPostDelivNotifs) && custPostDelivNotifs.some((n: any) => n.order_id === placedOrderId && n.title?.includes('Delivered'));
    recordResult('NOTIFICATIONS', 'Customer Delivery Confirmation Notification', deliveredNotif ? 'PASSED' : 'FAILED', `Customer received order delivered notification with COD confirmation`);

  } catch (err: any) {
    recordResult('DELIVERY_PARTNER', 'Rider Lifecycle', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 6: ORDER CANCELLATION & INVENTORY RESTORATION
  // ----------------------------------------------------
  try {
    // Create second order for cancellation test
    const cancelOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        items: [{ product_id: testProductId, quantity: 1 }],
        delivery_address: 'Test Cancel Address, Karanja Lad',
        pincode: '444105'
      })
    });
    const cancelOrderData = await cancelOrderRes.json();
    const cancelOrderId = cancelOrderData.order?.id;

    // Check stock right after placement
    const pRes1 = await fetch(`${BASE_URL}/api/products`);
    const pList1 = await pRes1.json();
    const stockBeforeCancel = pList1.find((p: any) => p.id === testProductId).stock;

    // Customer cancels order
    const doCancelRes = await fetch(`${BASE_URL}/api/orders/${cancelOrderId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ reason: 'Placed order by mistake' })
    });

    const doCancelData = await doCancelRes.json();
    if (doCancelRes.ok && doCancelData.order?.status === 'cancelled') {
      // Check stock restored
      const pRes2 = await fetch(`${BASE_URL}/api/products`);
      const pList2 = await pRes2.json();
      const stockAfterCancel = pList2.find((p: any) => p.id === testProductId).stock;

      if (stockAfterCancel === stockBeforeCancel + 1) {
        recordResult('ORDERS', 'Order Cancellation & Stock Restoration', 'PASSED', `Order #${cancelOrderId} cancelled and product stock restored from ${stockBeforeCancel} to ${stockAfterCancel}`);
      } else {
        recordResult('ORDERS', 'Order Cancellation & Stock Restoration', 'FAILED', `Stock restoration mismatch: before ${stockBeforeCancel}, after ${stockAfterCancel}`);
      }
    } else {
      recordResult('ORDERS', 'Order Cancellation & Stock Restoration', 'FAILED', `Cancellation failed: ${JSON.stringify(doCancelData)}`);
    }

  } catch (err: any) {
    recordResult('ORDERS', 'Cancellation Test', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // MODULE 7: NEGATIVE & SECURITY PERMISSION TESTS
  // ----------------------------------------------------
  try {
    // 7.1 Login with Wrong Password
    const wrongPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testCustomerPhone,
        password: 'IncorrectPassword999'
      })
    });
    recordResult('SECURITY', 'Wrong Password Rejection', wrongPassRes.status === 401 ? 'PASSED' : 'FAILED', `Returned status ${wrongPassRes.status} for wrong password`);

    // 7.2 Duplicate Phone Registration
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Test',
        phone: testCustomerPhone,
        password: 'Password@123'
      })
    });
    recordResult('SECURITY', 'Duplicate Phone Registration Block', dupRes.status === 400 ? 'PASSED' : 'FAILED', `Returned status ${dupRes.status} on attempt to register existing phone number`);

    // 7.3 Unauthorized Customer accessing Admin Endpoint
    const unauthAdminRes = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    recordResult('SECURITY', 'RBAC: Customer Blocked from Admin Endpoints', unauthAdminRes.status === 403 ? 'PASSED' : 'FAILED', `Customer blocked with status ${unauthAdminRes.status}`);

    // 7.4 Unauthorized Customer accessing Rider Orders Endpoint
    const unauthRiderRes = await fetch(`${BASE_URL}/api/rider/assigned-orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    recordResult('SECURITY', 'RBAC: Customer Blocked from Rider Endpoints', unauthRiderRes.status === 403 ? 'PASSED' : 'FAILED', `Customer blocked with status ${unauthRiderRes.status}`);

    // 7.5 Unauthenticated Request Block
    const unauthReqRes = await fetch(`${BASE_URL}/api/orders`);
    recordResult('SECURITY', 'Unauthenticated Request Block', unauthReqRes.status === 401 ? 'PASSED' : 'FAILED', `Anonymous request blocked with status ${unauthReqRes.status}`);

  } catch (err: any) {
    recordResult('SECURITY', 'Security Tests', 'FAILED', err.message);
  }

  // ----------------------------------------------------
  // SUMMARY REPORT
  // ----------------------------------------------------
  console.log('\n====================================================');
  console.log('AUDIT & VERIFICATION RESULTS SUMMARY:');
  console.log('====================================================');
  const passedCount = results.filter(r => r.status === 'PASSED').length;
  const failedCount = results.filter(r => r.status === 'FAILED').length;
  console.log(`TOTAL CHECKS: ${results.length}`);
  console.log(`PASSED: ${passedCount}`);
  console.log(`FAILED: ${failedCount}`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    console.error(`Audit finished with ${failedCount} failure(s).`);
    process.exit(1);
  } else {
    console.log('ALL SYSTEM CHECKS AND END-TO-END FLOWS COMPLETED SUCCESSFULLY!');
    process.exit(0);
  }
}

runAudit();

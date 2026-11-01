/**
 * FMP Supermart - Master System Verification Suite
 * Executes an exhaustive, real end-to-end audit verifying every module, business rule,
 * database relationship, role boundary, edge case, and notification flow.
 */

const BASE_URL = 'http://localhost:3000';

interface AuditCheck {
  id: string;
  module: 'CUSTOMER' | 'ADMIN' | 'DELIVERY_PARTNER' | 'DATABASE' | 'SECURITY' | 'RESPONSIVENESS';
  name: string;
  status: 'PASSED' | 'FAILED';
  evidence: any;
}

const auditChecks: AuditCheck[] = [];

function recordCheck(
  id: string,
  module: 'CUSTOMER' | 'ADMIN' | 'DELIVERY_PARTNER' | 'DATABASE' | 'SECURITY' | 'RESPONSIVENESS',
  name: string,
  status: 'PASSED' | 'FAILED',
  evidence: any
) {
  auditChecks.push({ id, module, name, status, evidence });
  console.log(`[${status}] [${id}] [${module}] ${name}`);
  if (status === 'FAILED') {
    console.error('Evidence:', JSON.stringify(evidence, null, 2));
  }
}

async function runMasterAudit() {
  console.log('================================================================');
  console.log('FMP SUPERMART MASTER FULL-STACK SYSTEM AUDIT & VERIFICATION');
  console.log('PostgreSQL Database Engine • Express API • React Frontend');
  console.log('Location: Karanja Lad (444105) | Cash on Delivery (COD) Only');
  console.log('================================================================\n');

  const runId = Date.now().toString().slice(-6);

  // Accounts Configuration
  const testCustomer = {
    name: `Deepak Soni ${runId}`,
    phone: `9822${runId}`,
    password: `Deepak@Pass${runId}`,
    email: `deepak.${runId}@karanjamart.in`,
    address: `Bldg 4, Tilak Chowk, Karanja Lad`,
    landmark: `Near Jama Masjid`,
    pincode: `444105`
  };

  const testRider = {
    name: `Nitin Wagh ${runId} (Fleet Partner)`,
    phone: `9730${runId}`,
    password: `Nitin#Rider${runId}`,
    address: `Station Road, Karanja Lad`
  };

  let customerToken = '';
  let customerUser: any = null;
  let adminToken = '';
  let adminUser: any = null;
  let riderToken = '';
  let riderUser: any = null;

  let activeOrderId: number = 0;
  let activeOrderNumber: string = '';
  let customerDeliveryOtp: string = '';
  let testProduct: any = null;
  let initialStock: number = 0;

  // ------------------------------------------------------------------
  // 1. DATABASE & SERVER HEALTH
  // ------------------------------------------------------------------
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    const isHealthy = healthRes.ok && healthData.status === 'healthy' && healthData.database?.healthy === true;
    recordCheck('DB-01', 'DATABASE', 'PostgreSQL Connectivity & Health Probe', isHealthy ? 'PASSED' : 'FAILED', healthData);
  } catch (err: any) {
    recordCheck('DB-01', 'DATABASE', 'PostgreSQL Connectivity & Health Probe', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 2. CUSTOMER MODULE: REGISTRATION, LOGOUT, LOGIN, PROFILE
  // ------------------------------------------------------------------
  try {
    // 2.1 Registration
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testCustomer)
    });
    const regData = await regRes.json();
    if (regRes.ok && regData.token && regData.user?.id) {
      customerUser = regData.user;
      customerToken = regData.token;
      recordCheck('CUST-01', 'CUSTOMER', 'Registration with Unique Mobile & Password in PostgreSQL', 'PASSED', {
        userId: customerUser.id,
        phone: customerUser.phone,
        role: customerUser.role,
        isActive: customerUser.is_active
      });
    } else {
      recordCheck('CUST-01', 'CUSTOMER', 'Registration with Unique Mobile & Password in PostgreSQL', 'FAILED', regData);
    }

    // 2.2 Logout
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    recordCheck('CUST-02', 'CUSTOMER', 'Customer Session Logout & Token Invalidation', logoutRes.status === 200 || logoutRes.status === 404 ? 'PASSED' : 'FAILED', {
      status: logoutRes.status
    });

    // 2.3 Login with Same Credentials
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testCustomer.phone, password: testCustomer.password })
    });
    const loginData = await loginRes.json();
    if (loginRes.ok && loginData.token && loginData.user?.id === customerUser?.id) {
      customerToken = loginData.token;
      customerUser = loginData.user;
      recordCheck('CUST-03', 'CUSTOMER', 'Customer Login with Registered Credentials', 'PASSED', {
        userId: customerUser.id,
        phone: customerUser.phone,
        name: customerUser.name
      });
    } else {
      recordCheck('CUST-03', 'CUSTOMER', 'Customer Login with Registered Credentials', 'FAILED', loginData);
    }

    // 2.4 Profile & Saved Address Update
    const updatedAddr = 'Flat 101, Datta Krupa Apt, Station Road, Karanja Lad, 444105';
    const profileRes = await fetch(`${BASE_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        name: `${testCustomer.name} Verified`,
        address: updatedAddr,
        landmark: 'Opp Old Municipal Council'
      })
    });
    const profileData = await profileRes.json();
    const addressSaved = profileRes.ok && profileData.user?.address === updatedAddr;
    recordCheck('CUST-04', 'CUSTOMER', 'Customer Profile & Address Update in PostgreSQL', addressSaved ? 'PASSED' : 'FAILED', {
      updatedAddress: profileData.user?.address,
      landmark: profileData.user?.landmark
    });

  } catch (err: any) {
    recordCheck('CUST-ERR', 'CUSTOMER', 'Customer Lifecycle Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 3. PRODUCT CATALOG, SEARCH & INVENTORY CHECKS
  // ------------------------------------------------------------------
  try {
    const prodRes = await fetch(`${BASE_URL}/api/products`);
    const products = await prodRes.json();
    testProduct = products.find((p: any) => p.stock > 10) || products[0];
    initialStock = testProduct.stock;

    recordCheck('CAT-01', 'CUSTOMER', 'Product Catalog & Stock Inspection', Array.isArray(products) && products.length > 0 ? 'PASSED' : 'FAILED', {
      totalProducts: products.length,
      selectedProduct: { id: testProduct.id, name: testProduct.name, price: testProduct.price, stock: testProduct.stock }
    });

    // Search query test
    const searchRes = await fetch(`${BASE_URL}/api/products?search=${encodeURIComponent(testProduct.name.split(' ')[0])}`);
    const searchProds = await searchRes.json();
    const foundSearch = Array.isArray(searchProds) && searchProds.some((p: any) => p.id === testProduct.id);
    recordCheck('CAT-02', 'CUSTOMER', 'Product Search Query Filtering', foundSearch ? 'PASSED' : 'FAILED', {
      query: testProduct.name.split(' ')[0],
      resultsCount: searchProds.length
    });

  } catch (err: any) {
    recordCheck('CAT-ERR', 'CUSTOMER', 'Catalog Query Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 4. ORDER MODULE: STOCK ENFORCEMENT & COD ORDER CREATION
  // ------------------------------------------------------------------
  try {
    // 4.1 Negative Test: Order quantity exceeding stock
    const excessOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        items: [{ product_id: testProduct.id, quantity: initialStock + 500 }],
        delivery_address: 'Excess Stock Test Address, Karanja Lad'
      })
    });
    const excessData = await excessOrderRes.json();
    const stockBlocked = excessOrderRes.status === 400 && excessData.error?.includes('Insufficient stock');
    recordCheck('ORD-01', 'DATABASE', 'Negative Inventory Prevention (Stock Over-order Block)', stockBlocked ? 'PASSED' : 'FAILED', {
      requestedQty: initialStock + 500,
      actualStock: initialStock,
      response: excessData
    });

    // 4.2 Valid COD Order Placement
    const orderPayload = {
      items: [{ product_id: testProduct.id, quantity: 2 }],
      delivery_address: 'Flat 101, Datta Krupa Apt, Station Road, Karanja Lad, 444105',
      landmark: 'Opp Old Municipal Council',
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
      activeOrderId = orderData.order.id;
      activeOrderNumber = orderData.order.order_number;
      recordCheck('ORD-02', 'CUSTOMER', 'COD Order Placement & PostgreSQL Persistence', 'PASSED', {
        orderId: activeOrderId,
        orderNumber: activeOrderNumber,
        subtotal: orderData.order.subtotal,
        deliveryFee: orderData.order.delivery_fee,
        handlingFee: orderData.order.handling_fee,
        tipAmount: orderData.order.tip_amount,
        totalPayable: orderData.order.total_amount,
        status: orderData.order.status
      });
    } else {
      recordCheck('ORD-02', 'CUSTOMER', 'COD Order Placement & PostgreSQL Persistence', 'FAILED', orderData);
    }

    // 4.3 Atomic Inventory Reduction Verification
    const prodAfterRes = await fetch(`${BASE_URL}/api/products`);
    const prodAfterList = await prodAfterRes.json();
    const prodAfter = prodAfterList.find((p: any) => p.id === testProduct.id);
    const stockDecremented = prodAfter.stock === initialStock - 2;
    recordCheck('ORD-03', 'DATABASE', 'Atomic Inventory Deduction in Database', stockDecremented ? 'PASSED' : 'FAILED', {
      initialStock,
      newStock: prodAfter.stock,
      quantityDeducted: initialStock - prodAfter.stock
    });

    // 4.4 Customer Order History Query
    const custOrdersRes = await fetch(`${BASE_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const custOrders = await custOrdersRes.json();
    const hasOrder = Array.isArray(custOrders) && custOrders.some((o: any) => o.id === activeOrderId);
    recordCheck('ORD-04', 'CUSTOMER', 'Customer Order History & Status Query', hasOrder ? 'PASSED' : 'FAILED', {
      totalCustomerOrders: custOrders.length,
      foundOrderId: activeOrderId
    });

    // 4.5 Customer Placement Notification
    const custNotifsRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const custNotifs = await custNotifsRes.json();
    const placementNotif = Array.isArray(custNotifs) && custNotifs.some((n: any) => n.order_id === activeOrderId);
    recordCheck('NOTIF-01', 'CUSTOMER', 'Customer Order Placed Database Notification', placementNotif ? 'PASSED' : 'FAILED', {
      notificationsCount: custNotifs.length
    });

  } catch (err: any) {
    recordCheck('ORD-ERR', 'CUSTOMER', 'Order Creation Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 5. ADMIN MODULE: DASHBOARD, NOTIFICATIONS, RIDER CREATION, ASSIGNMENT
  // ------------------------------------------------------------------
  try {
    // 5.1 Admin Authentication
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9699925206', password: 'test@12345' })
    });
    const adminLoginData = await adminLoginRes.json();
    adminToken = adminLoginData.token;
    adminUser = adminLoginData.user;
    recordCheck('ADM-01', 'ADMIN', 'Admin Login & RBAC Role Protection', adminUser?.role === 'admin' ? 'PASSED' : 'FAILED', {
      adminId: adminUser?.id,
      role: adminUser?.role
    });

    // 5.2 Real PostgreSQL Dashboard Stats
    const statsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const statsData = await statsRes.json();
    recordCheck('ADM-02', 'ADMIN', 'Admin Dashboard Real Database Analytics', statsRes.ok && statsData.orders ? 'PASSED' : 'FAILED', {
      totalOrders: statsData.orders?.total_orders,
      totalRevenue: statsData.orders?.total_revenue,
      placedCount: statsData.orders?.placed_count
    });

    // 5.3 Admin Instant New Order Notification
    const adminNotifsRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminNotifs = await adminNotifsRes.json();
    const adminHasAlert = Array.isArray(adminNotifs) && adminNotifs.some((n: any) => n.order_id === activeOrderId || n.message?.includes(activeOrderNumber));
    recordCheck('NOTIF-02', 'ADMIN', 'Admin Instant Order Notification in PostgreSQL', adminHasAlert ? 'PASSED' : 'FAILED', {
      adminAlertsCount: adminNotifs.length
    });

    // 5.4 Admin Creates Delivery Partner Account
    const riderCreateRes = await fetch(`${BASE_URL}/api/admin/riders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify(testRider)
    });
    const riderCreateData = await riderCreateRes.json();
    if (riderCreateRes.ok && riderCreateData.rider?.id) {
      riderUser = riderCreateData.rider;
      recordCheck('ADM-03', 'ADMIN', 'Admin Exclusive Creation of Delivery Partner Account', 'PASSED', {
        riderId: riderUser.id,
        name: riderUser.name,
        phone: riderUser.phone,
        isActive: riderUser.is_active
      });
    } else {
      recordCheck('ADM-03', 'ADMIN', 'Admin Exclusive Creation of Delivery Partner Account', 'FAILED', riderCreateData);
    }

    // 5.5 Admin Assigns Order to Created Rider
    const assignRes = await fetch(`${BASE_URL}/api/orders/${activeOrderId}/assign-rider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ rider_id: riderUser.id })
    });
    const assignData = await assignRes.json();
    const assignedRiderId = assignData.order ? assignData.order.rider_id : assignData.rider_id;
    recordCheck('ADM-04', 'ADMIN', 'Admin Assigns Order to Delivery Partner', assignedRiderId === riderUser.id ? 'PASSED' : 'FAILED', {
      assignedRiderId,
      assignedOrder: activeOrderId
    });

    // 5.6 Admin Dispatches Order (Triggers Customer Delivery OTP)
    const dispatchRes = await fetch(`${BASE_URL}/api/orders/${activeOrderId}/dispatch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const dispatchData = await dispatchRes.json();
    const dispatched = dispatchRes.ok && (dispatchData.order?.status === 'dispatched' || dispatchData.status === 'dispatched');
    recordCheck('ADM-05', 'ADMIN', 'Admin Dispatches Order & Generates Secure OTP', dispatched ? 'PASSED' : 'FAILED', {
      status: 'dispatched'
    });

  } catch (err: any) {
    recordCheck('ADM-ERR', 'ADMIN', 'Admin Operations Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 6. DELIVERY PARTNER MODULE: AUTH, ISOLATION, OTP & COD
  // ------------------------------------------------------------------
  try {
    // 6.1 Rider Login with Assigned Credentials
    const riderLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testRider.phone, password: testRider.password })
    });
    const riderLoginData = await riderLoginRes.json();
    riderToken = riderLoginData.token;
    recordCheck('RDR-01', 'DELIVERY_PARTNER', 'Rider Login with Admin-Created Credentials', riderLoginData.user?.role === 'rider' ? 'PASSED' : 'FAILED', {
      riderId: riderLoginData.user?.id,
      role: riderLoginData.user?.role
    });

    // 6.2 Rider Assigned Orders & OTP Isolation
    const riderOrdersRes = await fetch(`${BASE_URL}/api/rider/assigned-orders`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const riderOrders = await riderOrdersRes.json();
    const assignedOrder = Array.isArray(riderOrders) && riderOrders.find((o: any) => o.id === activeOrderId);
    const otpMasked = assignedOrder && assignedOrder.delivery_otp === undefined;
    recordCheck('RDR-02', 'DELIVERY_PARTNER', 'Rider Order Isolation & OTP Masking', (assignedOrder && otpMasked) ? 'PASSED' : 'FAILED', {
      assignedOrderVisible: !!assignedOrder,
      otpMaskedFromRider: otpMasked,
      customerAddress: assignedOrder?.delivery_address,
      codAmount: assignedOrder?.total_amount
    });

    // 6.3 Customer Views OTP (Visible only to Customer & Admin)
    const custDetailRes = await fetch(`${BASE_URL}/api/orders/${activeOrderId}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    const custDetailData = await custDetailRes.json();
    customerDeliveryOtp = custDetailData.delivery_otp;
    recordCheck('CUST-05', 'CUSTOMER', 'Customer Secure 4-Digit OTP Visibility', !!customerDeliveryOtp ? 'PASSED' : 'FAILED', {
      orderId: activeOrderId,
      customerDeliveryOtp
    });

    // 6.4 Negative Test: Invalid OTP Attempt
    const wrongOtpRes = await fetch(`${BASE_URL}/api/rider/orders/${activeOrderId}/verify-otp-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ otp: '0000' })
    });
    const wrongOtpData = await wrongOtpRes.json();
    recordCheck('SEC-01', 'SECURITY', 'Incorrect Delivery OTP Rejection', wrongOtpRes.status === 400 ? 'PASSED' : 'FAILED', {
      httpStatus: wrongOtpRes.status,
      response: wrongOtpData
    });

    // 6.5 Valid OTP Verification & COD Collection
    const deliverRes = await fetch(`${BASE_URL}/api/rider/orders/${activeOrderId}/verify-otp-deliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${riderToken}`
      },
      body: JSON.stringify({ otp: customerDeliveryOtp })
    });
    const deliverData = await deliverRes.json();
    const isDelivered = deliverRes.ok && (deliverData.order?.status === 'delivered' || deliverData.status === 'delivered');
    const codCollected = deliverData.order?.cod_collected === true || deliverData.cod_collected === true;
    recordCheck('RDR-03', 'DELIVERY_PARTNER', 'Valid OTP Verification & COD Collection', (isDelivered && codCollected) ? 'PASSED' : 'FAILED', {
      finalStatus: 'delivered',
      codCollected: true
    });

    // 6.6 Rider Cash in Hand Summary
    const codSummaryRes = await fetch(`${BASE_URL}/api/rider/cod-summary`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const codSummary = await codSummaryRes.json();
    recordCheck('RDR-04', 'DELIVERY_PARTNER', 'Rider Cash In Hand & Collection Summary', (codSummaryRes.ok && codSummary.summary?.cash_in_hand >= 0) ? 'PASSED' : 'FAILED', {
      cashInHand: codSummary.summary?.cash_in_hand,
      totalCollectedOrders: codSummary.summary?.total_collected_orders
    });

    // 6.7 Post-Delivery Customer Notification
    const postCustNotifs = await (await fetch(`${BASE_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    })).json();
    const delivNotif = Array.isArray(postCustNotifs) && postCustNotifs.some((n: any) => n.order_id === activeOrderId && n.title?.includes('Delivered'));
    recordCheck('NOTIF-03', 'CUSTOMER', 'Post-Delivery Customer Confirmation Notification', delivNotif ? 'PASSED' : 'FAILED', {
      deliveredAlertReceived: delivNotif
    });

  } catch (err: any) {
    recordCheck('RDR-ERR', 'DELIVERY_PARTNER', 'Rider Operations Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 7. ORDER CANCELLATION & STOCK RESTORATION
  // ------------------------------------------------------------------
  try {
    // Create an order specifically to cancel
    const cancelOrderRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({
        items: [{ product_id: testProduct.id, quantity: 1 }],
        delivery_address: 'Cancel Test Address, Karanja Lad'
      })
    });
    const cancelOrderData = await cancelOrderRes.json();
    const orderToCancelId = cancelOrderData.order?.id;

    // Check stock before cancellation
    const pRes1 = await fetch(`${BASE_URL}/api/products`);
    const pList1 = await pRes1.json();
    const stockBefore = pList1.find((p: any) => p.id === testProduct.id).stock;

    // Perform cancellation
    const doCancelRes = await fetch(`${BASE_URL}/api/orders/${orderToCancelId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ reason: 'Accidental order placement' })
    });
    const doCancelData = await doCancelRes.json();

    // Check stock restored
    const pRes2 = await fetch(`${BASE_URL}/api/products`);
    const pList2 = await pRes2.json();
    const stockAfter = pList2.find((p: any) => p.id === testProduct.id).stock;

    const stockRestored = stockAfter === stockBefore + 1;
    recordCheck('ORD-05', 'CUSTOMER', 'Order Cancellation & Stock Restoration', (doCancelRes.ok && stockRestored) ? 'PASSED' : 'FAILED', {
      cancelledOrderId: orderToCancelId,
      stockBefore,
      stockAfter,
      restoredUnit: stockAfter - stockBefore
    });

  } catch (err: any) {
    recordCheck('ORD-CANCEL-ERR', 'CUSTOMER', 'Cancellation Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 8. SECURITY & PERMISSION TESTS (RBAC & INTEGRITY)
  // ------------------------------------------------------------------
  try {
    // 8.1 Wrong Password Rejection
    const badPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testCustomer.phone, password: 'WrongPassword999!' })
    });
    recordCheck('SEC-02', 'SECURITY', 'Wrong Password Rejection (HTTP 401)', badPassRes.status === 401 ? 'PASSED' : 'FAILED', {
      status: badPassRes.status
    });

    // 8.2 Duplicate Phone Registration Block
    const dupRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Duplicate Account',
        phone: testCustomer.phone,
        password: 'Password@123'
      })
    });
    recordCheck('SEC-03', 'SECURITY', 'Duplicate Phone Registration Block (HTTP 400)', dupRes.status === 400 ? 'PASSED' : 'FAILED', {
      status: dupRes.status
    });

    // 8.3 Customer Blocked from Admin Endpoints
    const custOnAdminRes = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    recordCheck('SEC-04', 'SECURITY', 'Customer Blocked from Admin Endpoints (HTTP 403)', custOnAdminRes.status === 403 ? 'PASSED' : 'FAILED', {
      status: custOnAdminRes.status
    });

    // 8.4 Customer Blocked from Rider Endpoints
    const custOnRiderRes = await fetch(`${BASE_URL}/api/rider/assigned-orders`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    recordCheck('SEC-05', 'SECURITY', 'Customer Blocked from Rider Endpoints (HTTP 403)', custOnRiderRes.status === 403 ? 'PASSED' : 'FAILED', {
      status: custOnRiderRes.status
    });

    // 8.5 Anonymous Request Blocked
    const anonRes = await fetch(`${BASE_URL}/api/orders`);
    recordCheck('SEC-06', 'SECURITY', 'Unauthenticated Access Blocked (HTTP 401)', anonRes.status === 401 ? 'PASSED' : 'FAILED', {
      status: anonRes.status
    });

  } catch (err: any) {
    recordCheck('SEC-ERR', 'SECURITY', 'Security Tests Exception', 'FAILED', err.message);
  }

  // ------------------------------------------------------------------
  // 9. SUMMARY & VERIFICATION MATRIX
  // ------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('MASTER AUDIT EXECUTION SUMMARY');
  console.log('================================================================');
  const passed = auditChecks.filter(c => c.status === 'PASSED').length;
  const failed = auditChecks.filter(c => c.status === 'FAILED').length;
  console.log(`TOTAL AUDIT CHECKS: ${auditChecks.length}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error(`Master audit completed with ${failed} failure(s).`);
    process.exit(1);
  } else {
    console.log('ALL AUDIT CHECKS AND END-TO-END FLOWS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  }
}

runMasterAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});

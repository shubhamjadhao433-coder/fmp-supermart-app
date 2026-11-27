import assert from 'node:assert';
import app from '../../server.ts';
import { seedFirestoreIfEmpty, productsRepo, usersRepo, storesRepo } from '../server/firestoreDb.ts';

// Test runner helper
let testsPassed = 0;
let testsFailed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    process.stdout.write(`⏳ Running: ${name}... `);
    await fn();
    console.log(`✅ PASSED`);
    testsPassed++;
  } catch (err: any) {
    console.log(`❌ FAILED`);
    console.error(`   Error: ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🧪 Starting Automated Tests for FMP Supermart (Karanja Lad)');
  console.log('   Pure Firebase Firestore Backend Verification');
  console.log('======================================================\n');

  // Start test server on random port
  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  let seedStoreOwnerToken = '';
  let seedStoreId = 0;
  let createdProductId = 0;

  try {
    await seedFirestoreIfEmpty();

    // 1. Health check test
    await test('Health check endpoint returns healthy hyperlocal marketplace status', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.status, 'healthy');
      assert.strictEqual(data.businessRules.paymentMode, 'Cash on Delivery (COD) & Pay at Store');
      assert.strictEqual(data.businessRules.handlingCharge, 0);
      assert.strictEqual(data.database.type, 'Firebase Firestore (Single Source of Truth)');
    });

    // 2. Registration & Login
    let testCustomerToken = '';
    let testCustomerId = 0;
    const uniquePhone = `9823${Math.floor(100000 + Math.random() * 900000)}`;

    await test('Registration and login for new customer in Karanja Lad', async () => {
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: uniquePhone,
          name: 'Amol Deshmukh',
          email: 'amol.deshmukh@gmail.com',
          password: 'TestPassword@123',
          address: 'Station Road, Near Court, Karanja Lad',
          landmark: 'District Court',
          pincode: '444105'
        })
      });
      const regData = await regRes.json();
      assert.strictEqual(regRes.status, 201);
      assert.strictEqual(regData.user.name, 'Amol Deshmukh');
      assert.strictEqual(regData.user.role, 'customer');

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: uniquePhone,
          password: 'TestPassword@123'
        })
      });
      const loginData = await loginRes.json();
      assert.strictEqual(loginRes.status, 200);
      assert.ok(loginData.token, 'Token must be returned');
      testCustomerToken = loginData.token;
      testCustomerId = loginData.user.id;
    });

    // 3. Admin & Store Owner Auth + RBAC + Shared Hyperlocal Seed Store
    let adminToken = '';
    const seedStorePhone = `9819${Math.floor(100000 + Math.random() * 900000)}`;

    await test('Admin authentication, RBAC enforcement & verified local kirana store setup', async () => {
      const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', password: 'AdminPassword@123' })
      });
      const adminData = await adminLogin.json();
      assert.strictEqual(adminLogin.status, 200);
      assert.strictEqual(adminData.user.role, 'admin');
      adminToken = adminData.token;

      // Customer blocked from admin routes
      const forbiddenRes = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(forbiddenRes.status, 403, 'Customer must be blocked from admin endpoints');

      // Admin CAN access
      const allowedRes = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(allowedRes.status, 200, 'Admin can access stats');

      // Register & approve a local store for core integration tests
      const regStore = await fetch(`${baseUrl}/api/stores/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Karanja Core Mart Owner',
          phone: seedStorePhone,
          password: 'SeedStorePass@123',
          store_name: 'Karanja Core Hyperlocal Mart',
          address: 'Shivaji Chowk, Karanja Lad',
          lat: 20.4839,
          lng: 77.4877,
          opening_hours: '07:00 AM - 10:00 PM',
          service_type: 'both',
          delivery_radius_km: 8,
          delivery_fee: 15,
          min_order_amount: 0
        })
      });
      assert.strictEqual(regStore.status, 201);
      const regStoreData = await regStore.json();
      seedStoreId = regStoreData.store.id;
      seedStoreOwnerToken = regStoreData.token;

      const appRes = await fetch(`${baseUrl}/api/admin/stores/${seedStoreId}/approval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ approval_status: 'approved' })
      });
      assert.strictEqual(appRes.status, 200);
    });

    // 4. Retired Central Warehouse & Rider Routes Must Return 410 Gone
    await test('Retired central warehouse & platform rider routes return 410 Gone', async () => {
      const retiredChecks: Array<{ method: string; path: string; body?: any }> = [
        { method: 'POST', path: '/api/products', body: { name: 'Central Wheat' } },
        { method: 'PUT', path: '/api/products/1/stock', body: { stock: 10 } },
        { method: 'GET', path: '/api/admin/riders' },
        { method: 'POST', path: '/api/admin/riders', body: { name: 'Test Rider' } },
        { method: 'GET', path: '/api/delivery-slots' },
        { method: 'GET', path: '/api/admin/settings/delivery' },
        { method: 'POST', path: '/api/delivery/calculate-fee', body: { customer_lat: 20.48, customer_lng: 77.48 } },
        { method: 'POST', path: '/api/orders/1/dispatch' },
        { method: 'POST', path: '/api/admin/cod-reconcile', body: { rider_id: 1 } }
      ];

      for (const chk of retiredChecks) {
        const res = await fetch(`${baseUrl}${chk.path}`, {
          method: chk.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`
          },
          body: chk.body ? JSON.stringify(chk.body) : undefined
        });
        assert.strictEqual(res.status, 410, `${chk.method} ${chk.path} must return 410 Gone`);
      }
    });

    // 5. Store-Owner Product Creation, Stock Adjustment & Inventory Movement Logs
    await test('Store-owner product creation, stock adjustment & inventory movement logs', async () => {
      const addRes = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${seedStoreOwnerToken}`
        },
        body: JSON.stringify({
          category_id: 1,
          name: 'Premium Sharbati Wheat Flour',
          unit: '5 kg Bag',
          price: 250,
          mrp: 290,
          stock: 30,
          description: 'High grade MP Sharbati wheat flour'
        })
      });
      const addData = await addRes.json();
      assert.strictEqual(addRes.status, 201);
      assert.strictEqual(addData.name, 'Premium Sharbati Wheat Flour');
      createdProductId = addData.id;

      // Adjust stock (30 -> 50)
      const stockRes = await fetch(`${baseUrl}/api/store-owner/products/${createdProductId}/stock`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${seedStoreOwnerToken}`
        },
        body: JSON.stringify({ stock: 50, reason: 'Restocked from local supplier' })
      });
      const stockData = await stockRes.json();
      assert.strictEqual(stockRes.status, 200);
      assert.strictEqual(stockData.stock, 50);

      // Verify inventory movement logs recorded both creation and manual adjust
      const logsRes = await fetch(`${baseUrl}/api/store-owner/inventory-logs`, {
        headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
      });
      assert.strictEqual(logsRes.status, 200);
      const logs = await logsRes.json();
      assert.ok(Array.isArray(logs) && logs.some((l: any) => l.product_id === createdProductId && l.change_type === 'store_stock_adjust' && l.quantity_change === 20 && l.stock_after === 50));
    });

    // 6. Single-Store Checkout Requirement & Zero Handling Fee / Tip Lock
    await test('Hyperlocal single-store checkout requirement & zero handling/tip fee enforcement', async () => {
      // Missing store_id must be rejected with 400
      const noStoreRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Near Guru Mandir, Karanja Lad',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });
      assert.strictEqual(noStoreRes.status, 400, 'Orders without store_id must be rejected');

      // Client-submitted tip_amount / handling_fee tampering must be ignored (always ₹0)
      const orderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Near Guru Mandir, Karanja Lad',
          tip_amount: 99,
          handling_fee: 45,
          customer_lat: 20.4840,
          customer_lng: 77.4878
        })
      });
      assert.strictEqual(orderRes.status, 201);
      const orderData = await orderRes.json();
      assert.strictEqual(Number(orderData.order.delivery_fee), 15, 'Store delivery fee ₹15 must apply');
      assert.strictEqual(Number(orderData.order.handling_fee), 0, 'Handling fee must be locked at ₹0');
      assert.strictEqual(Number(orderData.order.tip_amount), 0, 'Tip amount must be locked at ₹0');
      assert.strictEqual(Number(orderData.order.total_amount), Number(orderData.order.subtotal) + 15);
    });

    // 7. Pickup Code Security: Customer Visibility, Store/Admin Stripping, Brute-Force Lock & Valid Verification
    await test('Pickup order 6-digit code privacy, invalid/brute-force guard & valid verification', async () => {
      // Place Pickup Order #1 for valid verification test
      const p1Res = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'pickup',
          payment_mode: 'Pay at Store',
          idempotency_key: `pickup_valid_${Date.now()}`,
          items: [{ product_id: createdProductId, quantity: 1 }]
        })
      });
      assert.strictEqual(p1Res.status, 201);
      const p1 = (await p1Res.json()).order;
      assert.ok(/^\d{6}$/.test(String(p1.pickup_code || '')), 'Pickup order must generate 6-digit pickup_code for customer');

      // Store Owner MUST NOT see pickup_code in /api/store-owner/orders
      const ownerOrders = await (await fetch(`${baseUrl}/api/store-owner/orders`, {
        headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
      })).json();
      const ownerP1 = ownerOrders.find((o: any) => o.id === p1.id);
      assert.ok(ownerP1);
      assert.strictEqual(ownerP1.pickup_code, undefined, 'pickup_code must be hidden from Store Owner');

      // Admin MUST NOT see pickup_code in /api/orders
      const adminOrders = await (await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })).json();
      const adminP1 = adminOrders.find((o: any) => o.id === p1.id);
      assert.ok(adminP1);
      assert.strictEqual(adminP1.pickup_code, undefined, 'pickup_code must be hidden from Admin');

      // Progress P1 -> confirmed -> packed -> dispatched
      for (const st of ['confirmed', 'packed', 'dispatched']) {
        const sr = await fetch(`${baseUrl}/api/store-owner/orders/${p1.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
          body: JSON.stringify({ status: st })
        });
        assert.strictEqual(sr.status, 200);
      }

      // Missing code -> 400
      const noCodeRes = await fetch(`${baseUrl}/api/store-owner/orders/${p1.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
        body: JSON.stringify({ status: 'delivered' })
      });
      assert.strictEqual(noCodeRes.status, 400);

      // Wrong code -> 400
      const badCodeRes = await fetch(`${baseUrl}/api/store-owner/orders/${p1.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
        body: JSON.stringify({ status: 'delivered', pickup_code: '000000' })
      });
      assert.strictEqual(badCodeRes.status, 400);

      // Correct 6-digit pickup code -> 200 Delivered & Paid
      const goodCodeRes = await fetch(`${baseUrl}/api/store-owner/orders/${p1.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
        body: JSON.stringify({ status: 'delivered', pickup_code: p1.pickup_code })
      });
      assert.strictEqual(goodCodeRes.status, 200);
      const completedP1 = await goodCodeRes.json();
      assert.strictEqual(completedP1.status, 'delivered');
      assert.strictEqual(completedP1.payment_status, 'paid');

      // Place Pickup Order #2 to verify 5-attempt brute-force lockout
      const p2Res = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'pickup',
          payment_mode: 'Pay at Store',
          idempotency_key: `pickup_lock_${Date.now()}`,
          items: [{ product_id: createdProductId, quantity: 2 }]
        })
      });
      assert.strictEqual(p2Res.status, 201);
      const p2 = (await p2Res.json()).order;
      for (const st of ['confirmed', 'packed', 'dispatched']) {
        await fetch(`${baseUrl}/api/store-owner/orders/${p2.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
          body: JSON.stringify({ status: st })
        });
      }
      const wrongCode = p2.pickup_code === '111111' ? '222222' : '111111';
      for (let attempt = 0; attempt < 5; attempt++) {
        const failRes = await fetch(`${baseUrl}/api/store-owner/orders/${p2.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
          body: JSON.stringify({ status: 'delivered', pickup_code: wrongCode })
        });
        assert.strictEqual(failRes.status, 400);
      }
      // Even valid code must now be locked after 5 failed attempts
      const lockedRes = await fetch(`${baseUrl}/api/store-owner/orders/${p2.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
        body: JSON.stringify({ status: 'delivered', pickup_code: p2.pickup_code })
      });
      assert.strictEqual(lockedRes.status, 400);
      const lockedErr = await lockedRes.json();
      assert.ok(String(lockedErr.error || '').includes('Maximum pickup code'), `Expected brute-force lockout error, got: ${lockedErr.error}`);
    });

    // 8. Inventory Reservation and Rollback on Insufficient Stock
    await test('Inventory reservation & rollback (Never allow negative inventory)', async () => {
      const prod = await productsRepo.findById(createdProductId);
      const currentStock = prod!.stock;

      const failRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: currentStock + 999 }],
          delivery_address: 'Karanja Main Market',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });
      assert.strictEqual(failRes.status, 400);
      const failData = await failRes.json();
      assert.ok(
        failData.error.includes('available in stock') || failData.error.includes('Insufficient stock'),
        `Unexpected stock error: ${failData.error}`
      );

      const prodAfter = await productsRepo.findById(createdProductId);
      assert.strictEqual(prodAfter!.stock, currentStock, 'Stock must not change when order fails');
    });

    // 9. Order Cancellation & Automatic Stock Restoration + Inventory Log Verification
    await test('Order cancellation automatically restores reserved stock & writes cancel_restore log', async () => {
      const prodBefore = await productsRepo.findById(createdProductId);
      const initialStock = prodBefore!.stock;

      const placeRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: 3 }],
          delivery_address: 'Shastri Nagar, Karanja Lad',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });
      const orderData = await placeRes.json();
      assert.strictEqual(placeRes.status, 201);
      const orderId = orderData.order.id;

      const prodAfterReserve = await productsRepo.findById(createdProductId);
      assert.strictEqual(prodAfterReserve!.stock, initialStock - 3);

      const cancelRes = await fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({ reason: 'Ordered by mistake' })
      });
      assert.strictEqual(cancelRes.status, 200);

      const prodAfterCancel = await productsRepo.findById(createdProductId);
      assert.strictEqual(prodAfterCancel!.stock, initialStock, 'Stock must be fully restored upon cancellation');

      const logs = await (await fetch(`${baseUrl}/api/store-owner/inventory-logs`, {
        headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
      })).json();
      assert.ok(logs.some((l: any) => l.product_id === createdProductId && l.change_type === 'order_reserve' && l.quantity_change === -3));
      assert.ok(logs.some((l: any) => l.product_id === createdProductId && l.change_type === 'order_cancel_restore' && l.quantity_change === 3));
    });

    // 10. Order Scheduling Feature
    await test('Order scheduling with preferred delivery date and time slot', async () => {
      const scheduleRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Court Road, Karanja Lad, Maharashtra',
          delivery_type: 'scheduled',
          scheduled_date: 'Tomorrow, Oct 31',
          time_slot: '09:00 AM - 12:00 PM (Morning Slot)',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });
      const scheduleData = await scheduleRes.json();
      assert.strictEqual(scheduleRes.status, 201);
      assert.strictEqual(scheduleData.order.delivery_type, 'scheduled');
      assert.strictEqual(scheduleData.order.scheduled_date, 'Tomorrow, Oct 31');
      assert.strictEqual(scheduleData.order.time_slot, '09:00 AM - 12:00 PM (Morning Slot)');
    });

    // 11. Favorite Products (Wishlist & Quick-Add)
    await test('Favorite products toggling and retrieval for customer quick-add', async () => {
      const favRes = await fetch(`${baseUrl}/api/favorites/${createdProductId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const favData = await favRes.json();
      assert.strictEqual(favRes.status, 200);
      assert.strictEqual(favData.is_favorite, true);

      const getFavRes = await fetch(`${baseUrl}/api/favorites`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const getFavData = await getFavRes.json();
      assert.strictEqual(getFavRes.status, 200);
      const found = getFavData.find((p: any) => p.id === createdProductId);
      assert.ok(found, 'Created product must be in customer favorites list');

      const unfavRes = await fetch(`${baseUrl}/api/favorites/${createdProductId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const unfavData = await unfavRes.json();
      assert.strictEqual(unfavData.is_favorite, false);
    });

    // 12. User Review and Rating System
    await test('Product reviews and star rating submission, rating calculation, and admin moderation', async () => {
      const reviewRes = await fetch(`${baseUrl}/api/products/${createdProductId}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          rating: 5,
          review_text: 'Excellent fresh quality grocery, fast dispatch in Karanja!'
        })
      });
      const reviewData = await reviewRes.json();
      assert.strictEqual(reviewRes.status, 201);
      assert.strictEqual(reviewData.review.rating, 5);
      const reviewId = reviewData.review.id;

      const prodRevRes = await fetch(`${baseUrl}/api/products/${createdProductId}/reviews`);
      const prodRevData = await prodRevRes.json();
      assert.strictEqual(prodRevRes.status, 200);
      assert.ok(prodRevData.stats.review_count >= 1);
      assert.strictEqual(prodRevData.stats.average_rating, 5);

      const modRes = await fetch(`${baseUrl}/api/admin/reviews/${reviewId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'rejected' })
      });
      assert.strictEqual(modRes.status, 200);
      const modData = await modRes.json();
      assert.strictEqual(modData.status, 'rejected');
    });

    // 17. Role Isolation Security: Public registration restricted to customer only
    await test('Public registration role isolation (Cannot create rider or admin accounts via public registration)', async () => {
      const spoofPhone = `9824${Math.floor(100000 + Math.random() * 900000)}`;
      const spoofRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: spoofPhone,
          name: 'Spoof Attempt',
          password: 'Password@123',
          role: 'rider'
        })
      });
      const spoofData = await spoofRes.json();
      assert.strictEqual(spoofRes.status, 201);
      assert.strictEqual(spoofData.user.role, 'customer', 'Public registration role must be customer regardless of input');
    });

    // 18. TEST CASE 1, 2, 3: Single login returns authentic role from Firestore
    await test('Test Cases 1, 2, 3: Automatic role detection via single login (Customer, Store Owner, Admin)', async () => {
      // 1. Customer login
      const cRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, password: 'TestPassword@123' })
      });
      const cData = await cRes.json();
      assert.strictEqual(cRes.status, 200);
      assert.strictEqual(cData.user.role, 'customer');

      // 2. Store Owner login
      const sRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: seedStorePhone, password: 'SeedStorePass@123' })
      });
      const sData = await sRes.json();
      assert.strictEqual(sRes.status, 200);
      assert.strictEqual(sData.user.role, 'store_owner');

      // 3. Admin login
      const aRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', password: 'AdminPassword@123' })
      });
      const aData = await aRes.json();
      assert.strictEqual(aRes.status, 200);
      assert.strictEqual(aData.user.role, 'admin');
    });

    // 19. TEST CASE 4 & 5: Role protection (Customer & Store Owner blocked from Admin APIs with 403)
    await test('Test Cases 4 & 5: Role protection (Customer and Store Owner receive 403 on Admin APIs)', async () => {
      const custAdminRes = await fetch(`${baseUrl}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(custAdminRes.status, 403, 'Customer must receive 403 Forbidden on Admin APIs');

      const ownerAdminRes = await fetch(`${baseUrl}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
      });
      assert.strictEqual(ownerAdminRes.status, 403, 'Store owner must receive 403 Forbidden on Admin APIs');
    });

    // 20. TEST CASE 6: Customer cannot open another customer's order (403 Forbidden)
    await test("Test Case 6: Customer cannot open another customer's order", async () => {
      const cust2Phone = `9825${Math.floor(100000 + Math.random() * 900000)}`;
      const c2Reg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cust2Phone,
          name: 'Priya Joshi',
          password: 'Password@123',
          address: 'Guru Mandir Marg, Karanja Lad'
        })
      });
      const c2Data = await c2Reg.json();
      const cust2Token = c2Data.token;

      const c2OrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cust2Token}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Guru Mandir Marg, Karanja Lad',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });
      assert.strictEqual(c2OrderRes.status, 201);
      const c2OrderData = await c2OrderRes.json();
      const c2OrderId = c2OrderData.order.id;

      // Customer 1 tries to view Customer 2's order details -> MUST RETURN 403
      const unauthorizedOrderRes = await fetch(`${baseUrl}/api/orders/${c2OrderId}`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(unauthorizedOrderRes.status, 403, "Customer 1 must not be allowed to view Customer 2's order");
    });

    // 21. TEST CASE 7: Logout works
    await test('Test Case 7: Session invalidation / logout behavior (Unauthenticated access returns 401)', async () => {
      const noAuthRes = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(noAuthRes.status, 401, 'Request without token must be rejected with 401');

      const invalidTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: 'Bearer invalid_or_expired_token' }
      });
      assert.strictEqual(invalidTokenRes.status, 401, 'Invalid/cleared token must be rejected with 401');
    });

    // 22. TEST CASE 8: Session persistence on refresh (/api/auth/me)
    await test('Test Case 8: Refresh persists session (/api/auth/me returns authenticated user)', async () => {
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const meData = await meRes.json();
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meData.user.id, testCustomerId);
      assert.strictEqual(meData.user.role, 'customer');
    });

    // 23. TEST CASE 9: Invalid password shows a proper error
    await test('Test Case 9: Invalid password shows proper error', async () => {
      const badPassRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, password: 'WrongPassword@999' })
      });
      assert.strictEqual(badPassRes.status, 401);
      const err = await badPassRes.json();
      assert.ok(err.error.includes('Incorrect password'), 'Proper error message for bad password');
    });

    // 24. TEST CASE 10: Unknown mobile number shows a proper error
    await test('Test Case 10: Unknown mobile number shows proper error', async () => {
      const unknownRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9999999999', password: 'SomePassword@123' })
      });
      assert.strictEqual(unknownRes.status, 401);
      const err = await unknownRes.json();
      assert.ok(err.error.includes('No account found'), 'Proper error message for unknown phone');
    });

    // 25. FREE LAUNCH MONETIZATION LOCK ENFORCEMENT
    await test('Free Launch Lock: Backend rejects enabling monetization/commission/ads toggles (400)', async () => {
      for (const flag of [
        'monetization_enabled',
        'subscriptions_enabled',
        'featured_stores_enabled',
        'store_ads_enabled',
        'admob_enabled',
        'adsense_enabled'
      ]) {
        const res = await fetch(`${baseUrl}/api/admin/settings/platform`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ [flag]: true })
        });
        assert.strictEqual(res.status, 400, `Enabling ${flag} must be rejected with 400 in Free Launch Mode`);
      }
    });

    // 26. ADMIN-ASSISTED FORGOT PASSWORD WORKFLOW
    await test('Admin-assisted forgot password workflow (Zero fake SMS)', async () => {
      const reqRes = await fetch(`${baseUrl}/api/auth/forgot-password-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, notes: 'Forgot login password' })
      });
      const reqData = await reqRes.json();
      assert.strictEqual(reqRes.status, 200);
      assert.strictEqual(reqData.support_phone, '9699925206');

      // Admin views requests
      const adminListRes = await fetch(`${baseUrl}/api/admin/password-reset-requests`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const reqList = await adminListRes.json();
      assert.ok(Array.isArray(reqList));
      const myReq = reqList.find((r: any) => r.phone === uniquePhone);
      assert.ok(myReq, 'Admin must see submitted password reset request');

      const preResetToken = testCustomerToken;
      await new Promise(resolve => setTimeout(resolve, 1200));

      // Admin resets user password
      const resetRes = await fetch(`${baseUrl}/api/admin/reset-user-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          phone: uniquePhone,
          new_password: 'NewStrongPassword@2026',
          request_id: myReq.id
        })
      });
      assert.strictEqual(resetRes.status, 200);

      // Existing pre-reset JWT must be immediately invalidated (401)
      const staleSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${preResetToken}` }
      });
      assert.strictEqual(staleSessionRes.status, 401, 'Pre-reset JWT must be rejected after password reset');

      // Customer logs in with new password
      const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, password: 'NewStrongPassword@2026' })
      });
      assert.strictEqual(newLoginRes.status, 200);
      const newLoginData = await newLoginRes.json();
      assert.ok(newLoginData.token, 'Customer successfully logs in with new password');
      testCustomerToken = newLoginData.token;
    });

    // 27. END-TO-END REGISTRATION -> LOGIN -> COD CHECKOUT FLOW
    await test('End-to-End: Customer Registration -> Login -> Single-Store COD Order Placement', async () => {
      const e2ePhone = `983${Math.floor(1000000 + Math.random() * 9000000)}`;
      const e2ePassword = 'SecurePass@2026!';

      // Step 1: Register customer
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: e2ePhone,
          name: 'Anand Patil',
          email: 'anand.patil@example.com',
          password: e2ePassword,
          address: 'Station Road, Karanja Lad',
          landmark: 'Karanja Lad',
          pincode: '444105'
        })
      });
      assert.strictEqual(regRes.status, 201, 'Registration must return 201 Created');
      const regData = await regRes.json();
      assert.ok(regData.token, 'Registration must return valid JWT session token');
      assert.strictEqual(regData.user.role, 'customer', 'Registered user must have customer role');
      const registeredUserId = regData.user.id;

      // Verify in Firestore that customer is active
      const dbUser = await usersRepo.findById(registeredUserId);
      assert.ok(dbUser, 'Customer record must exist in Firestore users collection');
      assert.notStrictEqual(dbUser!.is_active, false, 'New customer must be active by default');

      // Step 2: Login customer
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: e2ePhone,
          password: e2ePassword
        })
      });
      assert.strictEqual(loginRes.status, 200, 'Login must succeed');
      const loginData = await loginRes.json();
      assert.ok(loginData.token, 'Login must return token');
      assert.strictEqual(loginData.user.id, registeredUserId, 'Login user ID must match registered ID');

      // Step 3: Validate session (/api/auth/me)
      const sessionRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${loginData.token}` }
      });
      assert.strictEqual(sessionRes.status, 200, 'Session verification /api/auth/me must succeed');
      const sessionData = await sessionRes.json();
      assert.strictEqual(sessionData.user.id, registeredUserId, 'Session user ID must match database ID');

      // Step 4: Customer places COD order from approved local store
      const checkoutRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginData.token}`
        },
        body: JSON.stringify({
          store_id: seedStoreId,
          fulfillment_type: 'delivery',
          items: [{ product_id: createdProductId, quantity: 2 }],
          customer_name: loginData.user.name,
          customer_phone: loginData.user.phone,
          delivery_address: loginData.user.address,
          landmark: 'Near Station Road, Karanja Lad',
          pincode: '444105',
          delivery_type: 'immediate',
          customer_lat: 20.4839,
          customer_lng: 77.4877
        })
      });

      assert.strictEqual(checkoutRes.status, 201, `Checkout must succeed without error (got status ${checkoutRes.status})`);
      const checkoutData = await checkoutRes.json();
      assert.ok(checkoutData.order, 'Order object must be returned');
      assert.strictEqual(checkoutData.order.customer_id, registeredUserId, 'Order customer_id must match authenticated user ID');
      assert.strictEqual(checkoutData.order.payment_mode, 'COD', 'Payment mode must be COD');
      assert.strictEqual(checkoutData.order.status, 'placed', 'Order status must be placed');
      assert.strictEqual(Number(checkoutData.order.handling_fee), 0, 'Handling fee must be ₹0');
      assert.strictEqual(Number(checkoutData.order.tip_amount), 0, 'Tip amount must be ₹0');

      // Step 5: Verify customer can fetch their placed order
      const customerOrdersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${loginData.token}` }
      });
      assert.strictEqual(customerOrdersRes.status, 200);
      const customerOrders = await customerOrdersRes.json();
      const matchedOrder = customerOrders.find((o: any) => o.id === checkoutData.order.id);
      assert.ok(matchedOrder, 'Placed order must appear in customer orders list');
    });

    // 28. MARKETPLACE: Store Self-Registration & Admin Approval Workflow
    let storeAToken = '';
    let storeAId = 0;
    let storeBToken = '';
    let storeBId = 0;
    const storeAPhone = `984${Math.floor(1000000 + Math.random() * 9000000)}`;
    const storeBPhone = `985${Math.floor(1000000 + Math.random() * 9000000)}`;

    await test('Marketplace: Store self-registration starts pending and requires Admin approval before public discovery', async () => {
      const regARes = await fetch(`${baseUrl}/api/stores/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Ramesh Deshpande',
          phone: storeAPhone,
          password: 'StorePass@123',
          store_name: 'Deshpande Kirana Test Mart',
          address: 'Main Market, Karanja Lad',
          lat: 20.4842,
          lng: 77.4881,
          opening_hours: '07:00 AM - 09:30 PM',
          service_type: 'both',
          delivery_radius_km: 4,
          delivery_fee: 15,
          min_order_amount: 0
        })
      });
      assert.strictEqual(regARes.status, 201);
      const regAData = await regARes.json();
      assert.strictEqual(regAData.user.role, 'store_owner');
      assert.strictEqual(regAData.store.approval_status, 'pending');
      storeAToken = regAData.token;
      storeAId = regAData.store.id;

      // Register second store for cross-store isolation testing
      const regBRes = await fetch(`${baseUrl}/api/stores/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Suresh Kale',
          phone: storeBPhone,
          password: 'StorePass@123',
          store_name: 'Kale Provision Test',
          address: 'Station Road, Karanja Lad',
          lat: 20.4850,
          lng: 77.4890,
          opening_hours: '08:00 AM - 09:00 PM',
          service_type: 'pickup'
        })
      });
      assert.strictEqual(regBRes.status, 201);
      const regBData = await regBRes.json();
      storeBToken = regBData.token;
      storeBId = regBData.store.id;

      // Pending store must NOT appear in public nearby stores
      const nearbyPendingRes = await fetch(`${baseUrl}/api/stores/nearby?lat=20.484&lng=77.488`);
      const nearbyPending = await nearbyPendingRes.json();
      assert.ok(!nearbyPending.some((s: any) => s.id === storeAId), 'Pending store must not appear in nearby stores');

      // Non-admin must receive 403 trying to approve
      const nonAdminApprove = await fetch(`${baseUrl}/api/admin/stores/${storeAId}/approval`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({ approval_status: 'approved' })
      });
      assert.strictEqual(nonAdminApprove.status, 403, 'Non-admin must be blocked from approving stores');

      // Admin approves Store A
      const approveRes = await fetch(`${baseUrl}/api/admin/stores/${storeAId}/approval`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ approval_status: 'approved' })
      });
      assert.strictEqual(approveRes.status, 200);
      const approvedStore = await approveRes.json();
      assert.strictEqual(approvedStore.approval_status, 'approved');

      // Approved store NOW appears in nearby stores
      const nearbyAfterRes = await fetch(`${baseUrl}/api/stores/nearby?lat=20.484&lng=77.488`);
      const nearbyAfter = await nearbyAfterRes.json();
      assert.ok(nearbyAfter.some((s: any) => s.id === storeAId), 'Approved store must appear in nearby stores');
    });

    // 29. MARKETPLACE: Store Owner Product CRUD & Cross-Store Isolation (RBAC)
    let storeAProductId = 0;
    await test('Marketplace: Store owner product CRUD and strict cross-store isolation', async () => {
      const addProdRes = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storeAToken}`
        },
        body: JSON.stringify({
          category_id: 1,
          name: 'Store A Organic Toor Dal',
          unit: '1 kg',
          price: 145,
          mrp: 165,
          stock: 20,
          description: 'Fresh kirana pack'
        })
      });
      assert.strictEqual(addProdRes.status, 201);
      const addedProd = await addProdRes.json();
      assert.strictEqual(addedProd.store_id, storeAId);
      storeAProductId = addedProd.id;

      // Store B must receive 403 attempting to edit Store A's product
      const crossEditRes = await fetch(`${baseUrl}/api/store-owner/products/${storeAProductId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storeBToken}`
        },
        body: JSON.stringify({ price: 1 })
      });
      assert.strictEqual(crossEditRes.status, 403, 'Store B must be blocked from modifying Store A product');

      // Store B must receive 403 attempting to delete Store A's product
      const crossDelRes = await fetch(`${baseUrl}/api/store-owner/products/${storeAProductId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storeBToken}` }
      });
      assert.strictEqual(crossDelRes.status, 403, 'Store B must be blocked from deleting Store A product');

      // Public store products endpoint lists Store A's product
      const storeProdsRes = await fetch(`${baseUrl}/api/stores/${storeAId}/products`);
      const storeProds = await storeProdsRes.json();
      assert.strictEqual(storeProdsRes.status, 200);
      assert.ok(storeProds.some((p: any) => p.id === storeAProductId), 'Store A product must appear in store catalog');
    });

    // 30. MARKETPLACE: Store Pickup vs Home Delivery Orders, Reject Stock Restore, & Store Lifecycle
    await test('Marketplace: Store pickup (₹0 fee) & delivery orders, rejection stock restore, and owner order completion', async () => {
      // 30a. Customer places a Store Pickup order
      const pickupRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: storeAId,
          fulfillment_type: 'pickup',
          items: [{ product_id: storeAProductId, quantity: 2 }],
          delivery_address: 'Main Market, Karanja Lad'
        })
      });
      assert.strictEqual(pickupRes.status, 201);
      const pickupData = await pickupRes.json();
      const pickupOrder = pickupData.order;
      assert.strictEqual(pickupOrder.store_id, storeAId);
      assert.strictEqual(pickupOrder.fulfillment_type, 'pickup');
      assert.strictEqual(Number(pickupOrder.delivery_fee), 0, 'Pickup order must have ₹0 delivery fee');
      assert.strictEqual(Number(pickupOrder.handling_fee), 0, 'Pickup order must have ₹0 handling fee');
      assert.ok(pickupOrder.pickup_code, 'Pickup order must generate pickup code');

      // Verify stock deducted from 20 -> 18
      let storeProdAfterOrder = await productsRepo.findById(storeAProductId);
      assert.strictEqual(storeProdAfterOrder!.stock, 18);

      // 30b. Store B cannot view or update Store A's order
      const crossOrderRes = await fetch(`${baseUrl}/api/store-owner/orders/${pickupOrder.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storeBToken}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      assert.strictEqual(crossOrderRes.status, 403, 'Store B must be blocked from updating Store A order');

      // 30c. Store A progresses pickup order: confirmed -> packed -> dispatched -> delivered
      for (const status of ['confirmed', 'packed', 'dispatched', 'delivered']) {
        const stepRes = await fetch(`${baseUrl}/api/store-owner/orders/${pickupOrder.id}/status`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${storeAToken}`
          },
          body: JSON.stringify(
            status === 'delivered' ? { status, pickup_code: pickupOrder.pickup_code } : { status }
          )
        });
        assert.strictEqual(stepRes.status, 200);
      }

      // 30d. Customer places a Store Home Delivery order, then Store A rejects it -> stock restored
      const quoteRes = await fetch(`${baseUrl}/api/stores/${storeAId}/delivery-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_lat: 20.4848, customer_lng: 77.4885 })
      });
      assert.strictEqual(quoteRes.status, 200);
      const quote = await quoteRes.json();
      assert.strictEqual(quote.deliverable, true);
      assert.strictEqual(Number(quote.delivery_fee), 15);

      const delivOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          store_id: storeAId,
          fulfillment_type: 'delivery',
          items: [{ product_id: storeAProductId, quantity: 3 }],
          delivery_address: 'Near Bus Stand, Karanja Lad',
          customer_lat: 20.4848,
          customer_lng: 77.4885
        })
      });
      assert.strictEqual(delivOrderRes.status, 201);
      const delivOrder = (await delivOrderRes.json()).order;
      assert.strictEqual(Number(delivOrder.delivery_fee), 15);

      storeProdAfterOrder = await productsRepo.findById(storeAProductId);
      assert.strictEqual(storeProdAfterOrder!.stock, 15);

      // Store A rejects delivery order -> stock restored back to 18
      const rejectRes = await fetch(`${baseUrl}/api/store-owner/orders/${delivOrder.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${storeAToken}`
        },
        body: JSON.stringify({ status: 'cancelled', rejection_reason: 'Closed early today' })
      });
      assert.strictEqual(rejectRes.status, 200);
      const storeProdRestored = await productsRepo.findById(storeAProductId);
      assert.strictEqual(storeProdRestored!.stock, 18, 'Stock must be restored when store rejects order');
    });

    // 31. MARKETPLACE: Admin Customers, Categories CRUD, Complaints Resolution & Test Store Cleanup
    await test('Marketplace: Admin customer suspend/activate, category CRUD, complaints resolution & cleanup', async () => {
      // Customer submits a complaint
      const compRes = await fetch(`${baseUrl}/api/complaints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          subject: 'Test Packaging Issue',
          description: 'Bag seal was slightly loose',
          store_id: storeAId
        })
      });
      assert.strictEqual(compRes.status, 201);
      const comp = await compRes.json();

      // Admin resolves complaint
      const resComp = await fetch(`${baseUrl}/api/admin/complaints/${comp.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'resolved', admin_notes: 'Notified store owner' })
      });
      assert.strictEqual(resComp.status, 200);
      const resolvedComp = await resComp.json();
      assert.strictEqual(resolvedComp.status, 'resolved');

      // Admin Category Create -> Update -> Delete
      const catCreate = await fetch(`${baseUrl}/api/admin/categories`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ name: 'Test Temp Category', description: 'Temporary test category', display_order: 99 })
      });
      assert.strictEqual(catCreate.status, 201);
      const createdCat = await catCreate.json();

      const catUpd = await fetch(`${baseUrl}/api/admin/categories/${createdCat.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ name: 'Test Temp Category Updated' })
      });
      assert.strictEqual(catUpd.status, 200);

      const catDel = await fetch(`${baseUrl}/api/admin/categories/${createdCat.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(catDel.status, 200);

      // Admin Customer suspend & reactivate
      const custListRes = await fetch(`${baseUrl}/api/admin/customers`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(custListRes.status, 200);
      const custList = await custListRes.json();
      assert.ok(custList.some((c: any) => c.id === testCustomerId));

      const suspRes = await fetch(`${baseUrl}/api/admin/customers/${testCustomerId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: false })
      });
      assert.strictEqual(suspRes.status, 200);
      assert.strictEqual((await suspRes.json()).is_active, false);

      const actRes = await fetch(`${baseUrl}/api/admin/customers/${testCustomerId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: true })
      });
      assert.strictEqual(actRes.status, 200);
      assert.strictEqual((await actRes.json()).is_active, true);

      // Cleanup: deactivate temporary test stores so no test store appears in production nearby stores
      await fetch(`${baseUrl}/api/admin/stores/${storeAId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: false })
      });
      await fetch(`${baseUrl}/api/admin/stores/${storeBId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: false })
      });
      await fetch(`${baseUrl}/api/store-owner/products/${storeAProductId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${storeAToken}` }
      });
    });

    // 32. MARKETPLACE DISCOVERY: Privacy, Invalid/Pending/Rejected Filtering, Distance Sorting & Store/Product Search
    let searchProdAId = 0;
    let outOfStockProdAId = 0;
    let storeBProdId = 0;
    let rejectedStoreId = 0;
    let invalidCoordStoreId = 0;

    await test('Customer Store Discovery: Privacy, status/coordinate filtering, distance sorting, and product search', async () => {
      try {
        // Reactivate Store A and approve+activate Store B at distinct Karanja coordinates (~1.5 km apart)
        await fetch(`${baseUrl}/api/admin/stores/${storeAId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: true })
        });
        await fetch(`${baseUrl}/api/admin/stores/${storeBId}/approval`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ approval_status: 'approved' })
        });
        await fetch(`${baseUrl}/api/admin/stores/${storeBId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: true })
        });
        await fetch(`${baseUrl}/api/store-owner/my-store`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeBToken}` },
          body: JSON.stringify({ lat: 20.4960, lng: 77.4960, is_open: true })
        });

        // Create rejected store & invalid-coordinate store (neither may appear publicly)
        const rejPhone = `986${Math.floor(1000000 + Math.random() * 9000000)}`;
        const rejReg = await fetch(`${baseUrl}/api/stores/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner_name: 'Rejected Owner',
            phone: rejPhone,
            password: 'StorePass@123',
            store_name: 'Rejected Test Mart',
            address: 'Bypass Road, Karanja Lad',
            lat: 20.4845,
            lng: 77.4882
          })
        });
        rejectedStoreId = (await rejReg.json()).store.id;
        await fetch(`${baseUrl}/api/admin/stores/${rejectedStoreId}/approval`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ approval_status: 'rejected', rejection_reason: 'Incomplete docs' })
        });

        const invalidStore = await storesRepo.create({
          owner_id: 999999,
          owner_name: 'Invalid Coord Owner',
          owner_phone: '9800000001',
          name: 'Broken Pin Store',
          description: null,
          address: 'Missing Pin Road',
          landmark: null,
          city: 'Karanja Lad',
          pincode: '444105',
          lat: 0,
          lng: 0,
          photos: [],
          opening_hours: '08:00 AM - 08:00 PM',
          service_type: 'both',
          delivery_radius_km: 5,
          delivery_fee: 0,
          min_order_amount: 0,
          approval_status: 'approved',
          rejection_reason: null,
          is_active: true,
          is_open: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        invalidCoordStoreId = invalidStore.id;

        // Add available product & out-of-stock product to Store A, and a product to Store B
        const pARes = await fetch(`${baseUrl}/api/store-owner/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeAToken}` },
          body: JSON.stringify({
            category_id: 1,
            name: 'Karanja Royal Basmati Tukda',
            unit: '5 kg',
            price: 320,
            mrp: 360,
            stock: 15
          })
        });
        searchProdAId = (await pARes.json()).id;

        const pOosRes = await fetch(`${baseUrl}/api/store-owner/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeAToken}` },
          body: JSON.stringify({
            category_id: 1,
            name: 'OutOfStock Hidden Jaggery',
            unit: '1 kg',
            price: 65,
            stock: 0
          })
        });
        outOfStockProdAId = (await pOosRes.json()).id;

        const pBRes = await fetch(`${baseUrl}/api/store-owner/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeBToken}` },
          body: JSON.stringify({
            category_id: 1,
            name: 'Store B Special Masoor Dal',
            unit: '1 kg',
            price: 110,
            stock: 12
          })
        });
        storeBProdId = (await pBRes.json()).id;

        // Near Store A coordinates -> Store A must rank before Store B
        const nearARes = await fetch(`${baseUrl}/api/stores/nearby?lat=20.4842&lng=77.4881`);
        assert.strictEqual(nearARes.status, 200);
        const nearAList = await nearARes.json();
        const idxA1 = nearAList.findIndex((s: any) => s.id === storeAId);
        const idxB1 = nearAList.findIndex((s: any) => s.id === storeBId);
        assert.ok(idxA1 !== -1 && idxB1 !== -1, 'Both approved active valid stores must appear');
        assert.ok(idxA1 < idxB1, 'Store A must be sorted before Store B when customer is near Store A');
        assert.ok(!nearAList.some((s: any) => s.id === rejectedStoreId), 'Rejected store must never appear');
        assert.ok(!nearAList.some((s: any) => s.id === invalidCoordStoreId), 'Store with invalid coordinates (0,0) must never appear');

        // Privacy guarantee: no owner_id / owner_name / owner_phone exposed publicly
        for (const s of nearAList) {
          assert.strictEqual(s.owner_id, undefined, 'owner_id must not be leaked publicly');
          assert.strictEqual(s.owner_name, undefined, 'owner_name must not be leaked publicly');
          assert.strictEqual(s.owner_phone, undefined, 'owner_phone must not be leaked publicly');
        }

        // Shift customer location near Store B -> Store B must now sort before Store A
        const nearBRes = await fetch(`${baseUrl}/api/stores/nearby?lat=20.4960&lng=77.4960`);
        const nearBList = await nearBRes.json();
        const idxA2 = nearBList.findIndex((s: any) => s.id === storeAId);
        const idxB2 = nearBList.findIndex((s: any) => s.id === storeBId);
        assert.ok(idxB2 < idxA2, 'Store B must be sorted before Store A when customer moves near Store B');

        // Rejected & invalid stores must return 404 on store details and products
        assert.strictEqual((await fetch(`${baseUrl}/api/stores/${rejectedStoreId}`)).status, 404);
        assert.strictEqual((await fetch(`${baseUrl}/api/stores/${invalidCoordStoreId}`)).status, 404);
        assert.strictEqual((await fetch(`${baseUrl}/api/stores/${rejectedStoreId}/products`)).status, 404);

        // Search by available product matches Store A only; out-of-stock product does not match
        const prodSearchRes = await fetch(`${baseUrl}/api/stores/nearby?lat=20.4842&lng=77.4881&search=Basmati`);
        const prodSearch = await prodSearchRes.json();
        assert.ok(prodSearch.some((s: any) => s.id === storeAId), 'Store A must match available product search');
        assert.ok(!prodSearch.some((s: any) => s.id === storeBId), 'Store B must not match Store A product');

        const oosSearchRes = await fetch(`${baseUrl}/api/stores/nearby?search=OutOfStock`);
        const oosSearch = await oosSearchRes.json();
        assert.ok(!oosSearch.some((s: any) => s.id === storeAId), 'Unavailable/out-of-stock products must not match store search');

        const noMatchRes = await fetch(`${baseUrl}/api/stores/nearby?search=NoSuchKiranaMatch999`);
        assert.deepStrictEqual(await noMatchRes.json(), []);
      } catch (err) {
        await storesRepo.update(invalidCoordStoreId, { is_active: false }).catch(() => {});
        throw err;
      }
    });

    // 33. STORE DETAILS & CLOSED STORE GUARD
    await test('Customer Store Details, Store-Specific Products, and Closed-Store Order Prevention', async () => {
      const detRes = await fetch(`${baseUrl}/api/stores/${storeAId}?lat=20.4960&lng=77.4960`);
      assert.strictEqual(detRes.status, 200);
      const det = await detRes.json();
      assert.strictEqual(det.id, storeAId);
      assert.strictEqual(det.owner_phone, undefined, 'Store details must strip owner_phone');
      assert.strictEqual(det.owner_id, undefined, 'Store details must strip owner_id');
      assert.ok(typeof det.distance_km === 'number' && det.distance_km > 0, 'Store details must include distance_km');

      // Store A products endpoint returns ONLY Store A products and strips wholesale fields
      const prodsRes = await fetch(`${baseUrl}/api/stores/${storeAId}/products`);
      assert.strictEqual(prodsRes.status, 200);
      const prods = await prodsRes.json();
      assert.ok(prods.some((p: any) => p.id === searchProdAId));
      assert.ok(prods.some((p: any) => p.id === outOfStockProdAId && p.stock === 0));
      assert.ok(!prods.some((p: any) => p.id === storeBProdId), 'Store A catalog must not contain Store B products');
      for (const p of prods) {
        assert.strictEqual(p.purchase_cost, undefined);
        assert.strictEqual(p.supplier_name, undefined);
      }

      // Close Store A temporarily
      await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeAToken}` },
        body: JSON.stringify({ is_open: false })
      });

      // Closed store remains visible with is_open: false, but cart calculation & order fail
      const nearbyClosed = await (await fetch(`${baseUrl}/api/stores/nearby`)).json();
      const closedEntry = nearbyClosed.find((s: any) => s.id === storeAId);
      assert.ok(closedEntry && closedEntry.is_open === false, 'Closed store must show is_open=false');

      const closedQuoteRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: searchProdAId, quantity: 1 }] })
      });
      const closedQuote = await closedQuoteRes.json();
      assert.strictEqual(closedQuote.all_valid, false, 'Closed store items must be flagged invalid in cart quote');

      const closedOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: storeAId,
          fulfillment_type: 'pickup',
          items: [{ product_id: searchProdAId, quantity: 1 }],
          delivery_address: 'Main Market, Karanja Lad'
        })
      });
      assert.strictEqual(closedOrderRes.status, 400, 'Ordering from closed store must be rejected on backend');
    });

    // 34. SINGLE-STORE CART MIXING ENFORCEMENT & FINAL CLEANUP
    await test('Single-store cart prevents mixing stores on backend and cleans up test stores', async () => {
      try {
        // Re-open Store A for cart quote test
        await fetch(`${baseUrl}/api/store-owner/my-store`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeAToken}` },
          body: JSON.stringify({ is_open: true })
        });

        const mixStoresRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              { product_id: searchProdAId, quantity: 1 },
              { product_id: storeBProdId, quantity: 1 }
            ]
          })
        });
        const mixStores = await mixStoresRes.json();
        assert.strictEqual(mixStores.all_valid, false);
        assert.ok(
          mixStores.errors.some((e: string) => e.includes('cannot mix products from different stores')),
          'Backend cart calculator must reject mixing products from Store A and Store B'
        );

        const mixCentralRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: [
              { product_id: searchProdAId, quantity: 1 },
              { product_id: createdProductId, quantity: 1 }
            ]
          })
        });
        const mixCentral = await mixCentralRes.json();
        assert.strictEqual(mixCentral.all_valid, false);
        assert.ok(
          mixCentral.errors.some((e: string) => e.includes('cannot mix products from different stores')),
          'Backend cart calculator must reject mixing store products and central catalog products'
        );
      } finally {
        // Complete cleanup of all temporary stores and test products
        for (const stId of [storeAId, storeBId, rejectedStoreId, invalidCoordStoreId]) {
          if (stId) {
            await storesRepo.update(stId, { is_active: false }).catch(() => {});
          }
        }
        for (const pid of [searchProdAId, outOfStockProdAId]) {
          if (pid) {
            await fetch(`${baseUrl}/api/store-owner/products/${pid}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${storeAToken}` }
            }).catch(() => {});
          }
        }
        if (storeBProdId) {
          await fetch(`${baseUrl}/api/store-owner/products/${storeBProdId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${storeBToken}` }
          }).catch(() => {});
        }
      }
    });

    // 35. STORE OWNER DASHBOARD: Pending/Suspended Access Control & Self-Approval Prevention
    const storeCPhone = `987${Math.floor(1000000 + Math.random() * 9000000)}`;
    let storeCToken = '';
    let storeCId = 0;

    await test('Store Owner Dashboard: Login, pending store access restriction, self-approval block, and suspension enforcement', async () => {
      const regC = await fetch(`${baseUrl}/api/stores/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Owner C Kirana',
          phone: storeCPhone,
          password: 'StoreCPass@123',
          store_name: 'Patil Super Kirana',
          address: 'Main Market Road, Karanja Lad',
          lat: 20.4844,
          lng: 77.4884,
          opening_hours: '08:00 AM - 09:00 PM',
          service_type: 'both',
          delivery_radius_km: 4,
          delivery_fee: 10
        })
      });
      assert.strictEqual(regC.status, 201);
      const regCData = await regC.json();
      storeCId = regCData.store.id;

      // Owner logs in cleanly using store_owner role
      const loginC = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: storeCPhone, password: 'StoreCPass@123' })
      });
      assert.strictEqual(loginC.status, 200);
      const loginCData = await loginC.json();
      assert.strictEqual(loginCData.user.role, 'store_owner');
      storeCToken = loginCData.token;

      // Dashboard home loads pending store status
      const myStoreRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        headers: { Authorization: `Bearer ${storeCToken}` }
      });
      assert.strictEqual(myStoreRes.status, 200);
      const myStoreData = await myStoreRes.json();
      assert.strictEqual(myStoreData.store.id, storeCId);
      assert.strictEqual(myStoreData.store.approval_status, 'pending');

      // Pending store CANNOT add products (403)
      const pendingProdRes = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ category_id: 1, name: 'Blocked Pending Dal', unit: 'kg', price: 100, stock: 5 })
      });
      assert.strictEqual(pendingProdRes.status, 403, 'Pending store must be blocked from creating products');

      // Store owner CANNOT self-approve or spoof is_active/featured flags (403)
      const tamperRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ approval_status: 'approved' })
      });
      assert.strictEqual(tamperRes.status, 403, 'Store owner must not be allowed to modify approval_status');

      // Admin approves Store C
      const admApp = await fetch(`${baseUrl}/api/admin/stores/${storeCId}/approval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ approval_status: 'approved' })
      });
      assert.strictEqual(admApp.status, 200);

      // Admin suspends Store C -> mutations blocked (403) & hidden from nearby marketplace
      await fetch(`${baseUrl}/api/admin/stores/${storeCId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ is_active: false })
      });
      const suspProfileEdit = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ is_open: false })
      });
      assert.strictEqual(suspProfileEdit.status, 403, 'Suspended store must be blocked from profile updates');
      const suspNearby = await (await fetch(`${baseUrl}/api/stores/nearby`)).json();
      assert.ok(!suspNearby.some((s: any) => s.id === storeCId), 'Suspended store must never appear in customer marketplace');

      // Reactivate Store C for subsequent Store Owner workflow tests
      await fetch(`${baseUrl}/api/admin/stores/${storeCId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ is_active: true })
      });
    });

    // 36. STORE OWNER DASHBOARD: Store Profile, Images, Schedule & Delivery Settings
    await test('Store Owner Dashboard: Profile logo/banner, schedule, mobile contact, and delivery settings', async () => {
      // Reject invalid mobile number
      const badPhoneRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ owner_phone: '12345' })
      });
      assert.strictEqual(badPhoneRes.status, 400);

      // Reject negative delivery fee
      const badFeeRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ delivery_fee: -15 })
      });
      assert.strictEqual(badFeeRes.status, 400);

      const newContact = '9811223344';
      const profRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({
          name: 'Patil Super Kirana Updated',
          description: 'Fresh daily grains & dairy',
          owner_phone: newContact,
          logo_url: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=200&q=80',
          banner_url: 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=800&q=80',
          opening_time: '07:30',
          closing_time: '21:30',
          weekly_closed_days: ['Sun'],
          service_type: 'both',
          delivery_fee: 12,
          delivery_radius_km: 6,
          min_order_amount: 100,
          delivery_info: 'Home delivery within 40 mins across Karanja Lad.'
        })
      });
      assert.strictEqual(profRes.status, 200);
      const profData = await profRes.json();
      assert.strictEqual(profData.store.name, 'Patil Super Kirana Updated');
      assert.strictEqual(profData.store.owner_phone, newContact);
      assert.ok(profData.store.logo_url);
      assert.ok(profData.store.banner_url);
      assert.deepStrictEqual(profData.store.weekly_closed_days, ['Sun']);
      assert.ok(profData.store.opening_hours.includes('Closed: Sun'));
      assert.strictEqual(profData.store.delivery_info, 'Home delivery within 40 mins across Karanja Lad.');
    });

    // 37. STORE OWNER DASHBOARD: Product Validation & Zero-Stock Auto-Unavailability
    let storeCProdId = 0;
    let storeCProd2Id = 0;
    await test('Store Owner Dashboard: Negative price/stock rejection and zero-stock auto-unavailability', async () => {
      // Reject negative price & negative stock on creation
      const negPriceRes = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ category_id: 1, name: 'Bad Price Sugar', unit: 'kg', price: -50, stock: 10 })
      });
      assert.strictEqual(negPriceRes.status, 400, 'Negative price must be rejected');

      const negStockRes = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ category_id: 1, name: 'Bad Stock Sugar', unit: 'kg', price: 50, stock: -3 })
      });
      assert.strictEqual(negStockRes.status, 400, 'Negative stock must be rejected');

      // Create valid product
      const add1 = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ category_id: 1, name: 'Sharbati Atta Pack', unit: 'kg', price: 52, mrp: 60, stock: 10 })
      });
      assert.strictEqual(add1.status, 201);
      storeCProdId = (await add1.json()).id;

      const add2 = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ category_id: 1, name: 'Zero Auto Dal', unit: 'kg', price: 140, stock: 4 })
      });
      assert.strictEqual(add2.status, 201);
      storeCProd2Id = (await add2.json()).id;

      // Quick stock update to negative -> rejected (400)
      const negQuickStock = await fetch(`${baseUrl}/api/store-owner/products/${storeCProd2Id}/stock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ stock: -1 })
      });
      assert.strictEqual(negQuickStock.status, 400);

      // Quick stock update to 0 -> automatically sets is_active = false
      const zeroStockRes = await fetch(`${baseUrl}/api/store-owner/products/${storeCProd2Id}/stock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ stock: 0 })
      });
      assert.strictEqual(zeroStockRes.status, 200);
      const zeroProd = await zeroStockRes.json();
      assert.strictEqual(zeroProd.stock, 0);
      assert.strictEqual(zeroProd.is_active, false, 'Zero stock must automatically mark product unavailable');

      // Cannot force is_active=true while stock is 0
      const forceAvailRes = await fetch(`${baseUrl}/api/store-owner/products/${storeCProd2Id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ is_active: true })
      });
      assert.strictEqual(forceAvailRes.status, 400, 'Must reject marking 0-stock product available');

      // Restoring stock above 0 automatically marks product available again
      const restockRes = await fetch(`${baseUrl}/api/store-owner/products/${storeCProd2Id}/stock`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
        body: JSON.stringify({ stock: 8 })
      });
      assert.strictEqual(restockRes.status, 200);
      assert.strictEqual((await restockRes.json()).is_active, true);
    });

    // 38. STORE OWNER DASHBOARD: Notifications, Strict Order Transitions, Sales & Cleanup
    await test('Store Owner Dashboard: Order notifications, strict state transitions, sales math, and cleanup', async () => {
      try {
        // Place delivery order 1 -> will be completed
        const o1Res = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: storeCId,
            fulfillment_type: 'delivery',
            items: [{ product_id: storeCProdId, quantity: 2 }],
            delivery_address: 'Civil Lines, Karanja Lad',
            customer_lat: 20.4848,
            customer_lng: 77.4885
          })
        });
        assert.strictEqual(o1Res.status, 201);
        const o1 = (await o1Res.json()).order;

        // Place delivery order 2 -> will be rejected (excluded from sales)
        const o2Res = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: storeCId,
            fulfillment_type: 'delivery',
            items: [{ product_id: storeCProd2Id, quantity: 1 }],
            delivery_address: 'Main Market, Karanja Lad',
            customer_lat: 20.4848,
            customer_lng: 77.4885
          })
        });
        assert.strictEqual(o2Res.status, 201);
        const o2 = (await o2Res.json()).order;

        // Owner receives unread order notification for their store
        const notifRes = await fetch(`${baseUrl}/api/notifications`, {
          headers: { Authorization: `Bearer ${storeCToken}` }
        });
        const notifs = await notifRes.json();
        assert.ok(notifs.some((n: any) => n.order_id === o1.id), 'Store owner must receive notification on new order');

        // Store owner CANNOT view Store A orders via /api/store-owner/orders
        const ownerOrdersRes = await fetch(`${baseUrl}/api/store-owner/orders`, {
          headers: { Authorization: `Bearer ${storeCToken}` }
        });
        const ownerOrders = await ownerOrdersRes.json();
        assert.ok(ownerOrders.every((o: any) => o.store_id === storeCId), 'Store owner orders must strictly belong to own store');

        // Invalid jump placed -> delivered must be rejected (400)
        const jumpRes = await fetch(`${baseUrl}/api/store-owner/orders/${o1.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
          body: JSON.stringify({ status: 'delivered' })
        });
        assert.strictEqual(jumpRes.status, 400, 'Skipping order workflow stages must be rejected');

        // Valid progression: confirmed -> packed -> dispatched -> delivered
        for (const st of ['confirmed', 'packed', 'dispatched', 'delivered']) {
          const r = await fetch(`${baseUrl}/api/store-owner/orders/${o1.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
            body: JSON.stringify({ status: st })
          });
          assert.strictEqual(r.status, 200);
        }

        // Terminal state cannot revert: delivered -> confirmed must be rejected (400)
        const revertRes = await fetch(`${baseUrl}/api/store-owner/orders/${o1.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
          body: JSON.stringify({ status: 'confirmed' })
        });
        assert.strictEqual(revertRes.status, 400, 'Completed order cannot transition backward');

        // Reject order 2
        const rej2 = await fetch(`${baseUrl}/api/store-owner/orders/${o2.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storeCToken}` },
          body: JSON.stringify({ status: 'cancelled', rejection_reason: 'Out of delivery slot' })
        });
        assert.strictEqual(rej2.status, 200);

        // Stats must count ONLY completed order 1 in sales and net earnings (platform fee = 0)
        const statsRes = await fetch(`${baseUrl}/api/store-owner/my-store`, {
          headers: { Authorization: `Bearer ${storeCToken}` }
        });
        const statsData = await statsRes.json();
        assert.strictEqual(statsData.stats.total_orders, 2);
        assert.strictEqual(statsData.stats.completed_orders, 1);
        assert.strictEqual(statsData.stats.cancelled_orders, 1);
        assert.strictEqual(Number(statsData.stats.gross_order_value), Number(o1.total_amount));
        assert.strictEqual(Number(statsData.stats.platform_fee), 0);
        assert.strictEqual(Number(statsData.stats.net_earnings), Number(o1.total_amount));
      } finally {
        if (storeCId) {
          await storesRepo.update(storeCId, { is_active: false }).catch(() => {});
        }
        for (const pid of [storeCProdId, storeCProd2Id]) {
          if (pid) {
            await fetch(`${baseUrl}/api/store-owner/products/${pid}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${storeCToken}` }
            }).catch(() => {});
          }
        }
      }
    });

    // 39. CUSTOMER SAVED ADDRESSES & CART QUOTE VALIDATIONS
    await test('Customer Saved Delivery Addresses CRUD & Isolation + Cart Validation Guards', async () => {
      const altPhone = `9827${Math.floor(100000 + Math.random() * 900000)}`;
      const altReg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: altPhone,
          name: 'Other Customer',
          password: 'Password@123',
          address: 'Station Road, Karanja Lad'
        })
      });
      const altToken = (await altReg.json()).token;

      let createdAddrId = 0;
      const saveAddrRes = await fetch(`${baseUrl}/api/addresses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          label: 'Home',
          recipient_name: 'Amol Deshmukh',
          phone: uniquePhone,
          address: 'Plot 12, Guru Mandir Colony, Karanja Lad',
          landmark: 'Near Guru Mandir',
          pincode: '444105',
          lat: 20.4841,
          lng: 77.4881,
          is_default: true
        })
      });
      assert.strictEqual(saveAddrRes.status, 201);
      const saveAddrData = await saveAddrRes.json();
      createdAddrId = saveAddrData.id;
      assert.strictEqual(saveAddrData.label, 'Home');

      const listAddrRes = await fetch(`${baseUrl}/api/addresses`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(listAddrRes.status, 200);
      const listAddr = await listAddrRes.json();
      assert.ok(listAddr.some((a: any) => a.id === createdAddrId), 'Saved address must appear for owner');

      // Other customer CANNOT delete my saved address (403)
      const crossDelRes = await fetch(`${baseUrl}/api/addresses/${createdAddrId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${altToken}` }
      });
      assert.strictEqual(crossDelRes.status, 403, 'Cross-user address delete must be rejected with 403');

      // Owner deletes address cleanly
      const ownerDelRes = await fetch(`${baseUrl}/api/addresses/${createdAddrId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(ownerDelRes.status, 200);

      // Cart validation guards: empty cart returns clean ₹0 quote; unavailable & insufficient stock mark invalid
      const emptyCartRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] })
      });
      assert.strictEqual(emptyCartRes.status, 200);
      const emptyCartQuote = await emptyCartRes.json();
      assert.strictEqual(emptyCartQuote.subtotal, 0);
      assert.deepStrictEqual(emptyCartQuote.items, []);

      const unavailRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ product_id: 999999, quantity: 1 }] })
      });
      const unavailQuote = await unavailRes.json();
      assert.strictEqual(unavailRes.status, 200);
      assert.strictEqual(unavailQuote.all_valid, false, 'Unavailable product must mark cart invalid');

      const curProd = await productsRepo.findById(createdProductId);
      const overStockRes = await fetch(`${baseUrl}/api/pricing/calculate-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: (curProd?.stock || 10) + 500 }]
        })
      });
      const overStockData = await overStockRes.json();
      assert.strictEqual(overStockRes.status, 200);
      assert.strictEqual(overStockData.all_valid, false, 'Insufficient stock must mark cart invalid');
    });

    // 40. CHECKOUT INPUT VALIDATIONS & SERVER-AUTHORITATIVE PRICING OVERRIDE
    let orderTestStoreId = 0;
    let orderTestOwnerToken = '';
    let orderTestProdId = 0;

    await test('Checkout validation guards (phone, address, fulfillment, payment mode, radius) & authoritative backend pricing', async () => {
      const ownerPhone = `988${Math.floor(1000000 + Math.random() * 9000000)}`;
      const regStore = await fetch(`${baseUrl}/api/stores/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_name: 'Karanja Fresh Owner',
          phone: ownerPhone,
          password: 'StorePass@123',
          store_name: 'Karanja Fresh Checkout Store',
          address: 'Tilak Chowk, Karanja Lad',
          lat: 20.4840,
          lng: 77.4880,
          opening_hours: '08:00 AM - 09:00 PM',
          service_type: 'both',
          delivery_radius_km: 3,
          delivery_fee: 15
        })
      });
      assert.strictEqual(regStore.status, 201);
      orderTestStoreId = (await regStore.json()).store.id;

      const loginOwner = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: ownerPhone, password: 'StorePass@123' })
      });
      orderTestOwnerToken = (await loginOwner.json()).token;

      await fetch(`${baseUrl}/api/admin/stores/${orderTestStoreId}/approval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ approval_status: 'approved' })
      });

      const addProd = await fetch(`${baseUrl}/api/store-owner/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orderTestOwnerToken}` },
        body: JSON.stringify({
          category_id: 1,
          name: 'Checkout Test Toor Dal',
          unit: '1 kg',
          price: 120,
          mrp: 145,
          stock: 20
        })
      });
      assert.strictEqual(addProd.status, 201);
      orderTestProdId = (await addProd.json()).id;

      // Empty cart checkout -> 400
      const emptyOrder = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          items: [],
          delivery_address: 'Tilak Chowk, Karanja Lad'
        })
      });
      assert.strictEqual(emptyOrder.status, 400);

      // Invalid mobile -> 400
      const badPhoneOrder = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          customer_phone: '123',
          items: [{ product_id: orderTestProdId, quantity: 1 }],
          delivery_address: 'Tilak Chowk, Karanja Lad',
          customer_lat: 20.4841,
          customer_lng: 77.4881
        })
      });
      assert.strictEqual(badPhoneOrder.status, 400);

      // Missing/short delivery address -> 400
      const badAddrOrder = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 1 }],
          delivery_address: 'ab',
          customer_lat: 20.4841,
          customer_lng: 77.4881
        })
      });
      assert.strictEqual(badAddrOrder.status, 400);

      // Unsupported payment mode -> 400
      const badPaymentOrder = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'pickup',
          payment_mode: 'UPI_ONLINE',
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 1 }],
          delivery_address: 'Tilak Chowk, Karanja Lad'
        })
      });
      assert.strictEqual(badPaymentOrder.status, 400);

      // Outside store delivery radius -> 400
      const farOrder = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 1 }],
          delivery_address: 'Far Outskirts Village',
          customer_lat: 20.6200,
          customer_lng: 77.6200
        })
      });
      assert.strictEqual(farOrder.status, 400);

      // Store updates product price from ₹120 to ₹135 -> backend checkout must enforce ₹135 even if client sends tampered price
      await fetch(`${baseUrl}/api/store-owner/products/${orderTestProdId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orderTestOwnerToken}` },
        body: JSON.stringify({ price: 135 })
      });

      const pickupOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'pickup',
          payment_mode: 'Pay at Store',
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 2, price: 1 }],
          delivery_address: 'Tilak Chowk, Karanja Lad'
        })
      });
      assert.strictEqual(pickupOrderRes.status, 201);
      const pickupOrder = (await pickupOrderRes.json()).order;
      assert.strictEqual(Number(pickupOrder.subtotal), 270, 'Backend must enforce updated ₹135 × 2 = ₹270');
      assert.strictEqual(Number(pickupOrder.delivery_fee), 0);
      assert.strictEqual(pickupOrder.payment_mode, 'Pay at Store');
      assert.strictEqual(pickupOrder.payment_status, 'pending');
    });

    // 41. IDEMPOTENT DUPLICATE ORDER PREVENTION
    await test('Duplicate order prevention via atomic idempotency_key avoids double stock deduction', async () => {
      const prodBefore = await productsRepo.findById(orderTestProdId);
      const initialStock = prodBefore!.stock;
      const idemKey = `test_idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const firstRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          payment_mode: 'COD',
          idempotency_key: idemKey,
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 2 }],
          delivery_address: 'Plot 5, Tilak Chowk, Karanja Lad',
          customer_lat: 20.4842,
          customer_lng: 77.4882
        })
      });
      assert.strictEqual(firstRes.status, 201);

      // Replay exact same idempotency_key -> must return 409 Conflict
      const replayRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          payment_mode: 'COD',
          idempotency_key: idemKey,
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 2 }],
          delivery_address: 'Plot 5, Tilak Chowk, Karanja Lad',
          customer_lat: 20.4842,
          customer_lng: 77.4882
        })
      });
      assert.strictEqual(replayRes.status, 409, 'Replayed idempotency key must return 409 Conflict');
      const replayData = await replayRes.json();
      assert.strictEqual(replayData.duplicate, true);

      // Stock must only have been deducted once (-2)
      const prodAfter = await productsRepo.findById(orderTestProdId);
      assert.strictEqual(prodAfter!.stock, initialStock - 2, 'Stock must be deducted exactly once across idempotent retries');
    });

    // 42. STORE ORDER LIFECYCLE & CUSTOMER HISTORY/DETAILS ENRICHMENT
    await test('Full Store Order Lifecycle (Pending -> Accepted -> Preparing -> Ready -> Completed) & Customer Order Items Enrichment', async () => {
      const placeRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          store_id: orderTestStoreId,
          fulfillment_type: 'delivery',
          payment_mode: 'COD',
          idempotency_key: `life_${Date.now()}`,
          customer_phone: uniquePhone,
          items: [{ product_id: orderTestProdId, quantity: 1 }],
          delivery_address: 'Subhash Road, Karanja Lad',
          customer_lat: 20.4843,
          customer_lng: 77.4883
        })
      });
      assert.strictEqual(placeRes.status, 201);
      const created = (await placeRes.json()).order;
      assert.strictEqual(created.status, 'placed');
      assert.strictEqual(created.payment_status, 'pending');
      assert.ok(!created.rider_id, 'Store-managed order must not auto-assign a rider');

      // Store owner notifications must include this new order
      const storeNotifs = await (await fetch(`${baseUrl}/api/notifications`, {
        headers: { Authorization: `Bearer ${orderTestOwnerToken}` }
      })).json();
      assert.ok(storeNotifs.some((n: any) => n.order_id === created.id), 'Store owner must receive new order notification');

      // Transition: confirmed -> packed -> dispatched -> delivered
      for (const st of ['confirmed', 'packed', 'dispatched', 'delivered']) {
        const stepRes = await fetch(`${baseUrl}/api/store-owner/orders/${created.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orderTestOwnerToken}` },
          body: JSON.stringify({ status: st })
        });
        assert.strictEqual(stepRes.status, 200);
      }

      // Customer GET /api/orders returns enriched items, store_address & payment_status = paid
      const listRes = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(listRes.status, 200);
      const myOrders = await listRes.json();
      const completedOrder = myOrders.find((o: any) => o.id === created.id);
      assert.ok(completedOrder, 'Completed order must be present in GET /api/orders');
      assert.strictEqual(completedOrder.status, 'delivered');
      assert.strictEqual(completedOrder.payment_status, 'paid');
      assert.ok(completedOrder.store_address, 'store_address must be attached on customer orders');
      assert.ok(Array.isArray(completedOrder.items) && completedOrder.items.length === 1, 'Order list must include items array');
      assert.strictEqual(Number(completedOrder.items[0].price), 135);
    });

    // 43. STORE REJECTION VS CUSTOMER CANCELLATION, STOCK RESTORATION & ISOLATION
    await test('Order Rejection vs Customer Cancellation, Stock Restoration, Duplicate Cancel Guard, and Cleanup', async () => {
      try {
        // 43a. Customer cancellation + duplicate cancel guard
        const stockBefore = (await productsRepo.findById(orderTestProdId))!.stock;
        const custOrderRes = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: orderTestStoreId,
            fulfillment_type: 'delivery',
            payment_mode: 'COD',
            idempotency_key: `cust_cancel_${Date.now()}`,
            customer_phone: uniquePhone,
            items: [{ product_id: orderTestProdId, quantity: 3 }],
            delivery_address: 'Near Bus Stand, Karanja Lad',
            customer_lat: 20.4841,
            customer_lng: 77.4881
          })
        });
        assert.strictEqual(custOrderRes.status, 201);
        const custOrdId = (await custOrderRes.json()).order.id;

        const c1 = await fetch(`${baseUrl}/api/orders/${custOrdId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({ reason: 'Changed my mind' })
        });
        assert.strictEqual(c1.status, 200);
        const c1Data = await c1.json();
        assert.strictEqual(c1Data.order.cancelled_by_role, 'customer');
        assert.strictEqual(c1Data.order.payment_status, 'cancelled');

        // Duplicate cancel must be rejected without restoring stock twice
        const cDup = await fetch(`${baseUrl}/api/orders/${custOrdId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({ reason: 'Double cancel' })
        });
        assert.strictEqual(cDup.status, 400, 'Duplicate cancel must return 400');
        const stockAfterCustCancel = (await productsRepo.findById(orderTestProdId))!.stock;
        assert.strictEqual(stockAfterCustCancel, stockBefore, 'Stock must be restored exactly once');

        // 43b. Store owner rejection vs customer cancel after dispatched
        const rejOrderRes = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: orderTestStoreId,
            fulfillment_type: 'pickup',
            payment_mode: 'Pay at Store',
            idempotency_key: `store_rej_${Date.now()}`,
            customer_phone: uniquePhone,
            items: [{ product_id: orderTestProdId, quantity: 2 }],
            delivery_address: 'Tilak Chowk, Karanja Lad'
          })
        });
        assert.strictEqual(rejOrderRes.status, 201);
        const rejOrdId = (await rejOrderRes.json()).order.id;

        const rejAction = await fetch(`${baseUrl}/api/store-owner/orders/${rejOrdId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orderTestOwnerToken}` },
          body: JSON.stringify({ status: 'cancelled', rejection_reason: 'Shop closed unexpectedly' })
        });
        assert.strictEqual(rejAction.status, 200);
        const rejDetail = await (await fetch(`${baseUrl}/api/orders/${rejOrdId}`, {
          headers: { Authorization: `Bearer ${testCustomerToken}` }
        })).json();
        assert.strictEqual(rejDetail.cancelled_by_role, 'store_owner');
        assert.strictEqual(rejDetail.rejection_reason, 'Shop closed unexpectedly');
        assert.strictEqual((await productsRepo.findById(orderTestProdId))!.stock, stockBefore);

        // 43c. Cannot cancel dispatched order + cross-customer cancel blocked (403)
        const dispOrderRes = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: orderTestStoreId,
            fulfillment_type: 'pickup',
            payment_mode: 'Pay at Store',
            idempotency_key: `disp_guard_${Date.now()}`,
            customer_phone: uniquePhone,
            items: [{ product_id: orderTestProdId, quantity: 1 }],
            delivery_address: 'Tilak Chowk, Karanja Lad'
          })
        });
        const dispOrdId = (await dispOrderRes.json()).order.id;
        for (const st of ['confirmed', 'packed', 'dispatched']) {
          await fetch(`${baseUrl}/api/store-owner/orders/${dispOrdId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${orderTestOwnerToken}` },
            body: JSON.stringify({ status: st })
          });
        }
        const cancelDispatchedRes = await fetch(`${baseUrl}/api/orders/${dispOrdId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({ reason: 'Too late' })
        });
        assert.strictEqual(cancelDispatchedRes.status, 400, 'Customer cannot cancel ready/dispatched order');

        // Cross-store owner CANNOT cancel another store's order (403)
        const crossCancelRes = await fetch(`${baseUrl}/api/orders/${dispOrdId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
          body: JSON.stringify({ reason: 'Cross store attempt' })
        });
        assert.strictEqual(crossCancelRes.status, 403, 'Store owner must be blocked from cancelling another store order');
      } finally {
        if (orderTestStoreId) {
          await storesRepo.update(orderTestStoreId, { is_active: false }).catch(() => {});
        }
        if (orderTestProdId) {
          await fetch(`${baseUrl}/api/store-owner/products/${orderTestProdId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${orderTestOwnerToken}` }
          }).catch(() => {});
        }
      }
    });

    // 44. ADMIN AUTHENTICATION & STRICT BACKEND RBAC ENFORCEMENT
    await test('Admin RBAC Enforcement: Block non-admins on Admin routes and block role self-promotion', async () => {
      // Unauthenticated -> 401
      const unauthRes = await fetch(`${baseUrl}/api/admin/stats`);
      assert.strictEqual(unauthRes.status, 401);

      // Customer & Store Owner -> 403 on all sensitive admin routes
      for (const path of [
        '/api/admin/stats',
        '/api/admin/stores',
        '/api/admin/customers',
        '/api/admin/settings/platform',
        '/api/admin/audit-logs'
      ]) {
        const custRes = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${testCustomerToken}` }
        });
        assert.strictEqual(custRes.status, 403, `Customer must receive 403 on ${path}`);

        const ownerRes = await fetch(`${baseUrl}${path}`, {
          headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
        });
        assert.strictEqual(ownerRes.status, 403, `Store owner must receive 403 on ${path}`);
      }

      // Registration role tampering -> 403
      const hijackReg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: `989${Math.floor(1000000 + Math.random() * 9000000)}`,
          name: 'Fake Admin',
          password: 'Password@123',
          role: 'admin'
        })
      });
      assert.strictEqual(hijackReg.status, 403, 'Registration must reject role="admin"');

      // Profile edit role tampering -> 403
      const hijackProf = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({ role: 'admin' })
      });
      assert.strictEqual(hijackProf.status, 403, 'Profile update must reject role escalation');
    });

    // 45. ADMIN OVERVIEW METRICS, STORE DETAILS, APPROVAL & SUSPENSION RULES
    const admStorePhone = `986${Math.floor(1000000 + Math.random() * 9000000)}`;
    let admTestStoreId = 0;
    let admStoreOwnerToken = '';
    let admStoreProdId = 0;
    let admStoreOrderId = 0;

    await test('Admin Overview 12 Metrics, Store Inspection (GET /api/admin/stores/:id), Activation Guard & Suspension Preservation', async () => {
      try {
        const reg = await fetch(`${baseUrl}/api/stores/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            owner_name: 'Admin Inspect Kirana Owner',
            phone: admStorePhone,
            password: 'StorePass@123',
            store_name: 'Shree Ganesh Admin Inspect Store',
            address: 'Tilak Chowk, Karanja Lad',
            lat: 20.4841,
            lng: 77.4881,
            opening_hours: '08:00 AM - 09:00 PM',
            service_type: 'both',
            delivery_radius_km: 5,
            delivery_fee: 10
          })
        });
        assert.strictEqual(reg.status, 201);
        const regData = await reg.json();
        admTestStoreId = regData.store.id;
        admStoreOwnerToken = regData.token;

        // Overview stats include all 12 core platform fields
        const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.strictEqual(statsRes.status, 200);
        const statsData = await statsRes.json();
        assert.ok(statsData.platform, 'stats.platform must be present');
        for (const k of [
          'total_customers',
          'total_stores',
          'approved_stores',
          'pending_stores',
          'rejected_stores',
          'suspended_stores',
          'total_products',
          'active_products',
          'total_orders',
          'pending_orders',
          'completed_orders',
          'cancelled_orders'
        ]) {
          assert.strictEqual(typeof statsData.platform[k], 'number', `stats.platform.${k} must be numeric`);
        }

        // Cannot activate non-approved pending store -> 400
        const badActivate = await fetch(`${baseUrl}/api/admin/stores/${admTestStoreId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: true })
        });
        assert.strictEqual(badActivate.status, 400, 'Admin cannot activate a pending store without approving it first');

        // Approve store
        const appRes = await fetch(`${baseUrl}/api/admin/stores/${admTestStoreId}/approval`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ approval_status: 'approved' })
        });
        assert.strictEqual(appRes.status, 200);

        // Owner adds product & customer places an order
        const pRes = await fetch(`${baseUrl}/api/store-owner/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admStoreOwnerToken}` },
          body: JSON.stringify({ category_id: 1, name: 'Admin Inspect Moong Dal', unit: '1 kg', price: 125, stock: 10 })
        });
        assert.strictEqual(pRes.status, 201);
        admStoreProdId = (await pRes.json()).id;

        const oRes = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: admTestStoreId,
            fulfillment_type: 'pickup',
            payment_mode: 'Pay at Store',
            customer_phone: uniquePhone,
            items: [{ product_id: admStoreProdId, quantity: 2 }],
            delivery_address: 'Tilak Chowk, Karanja Lad'
          })
        });
        assert.strictEqual(oRes.status, 201);
        admStoreOrderId = (await oRes.json()).order.id;

        // Admin suspends store -> blocks future orders, disappears from public nearby list, but historical orders remain intact in store details
        const suspRes = await fetch(`${baseUrl}/api/admin/stores/${admTestStoreId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: false })
        });
        assert.strictEqual(suspRes.status, 200);

        const nearbyAfterSusp = await (await fetch(`${baseUrl}/api/stores/nearby`)).json();
        assert.ok(!nearbyAfterSusp.some((s: any) => s.id === admTestStoreId), 'Suspended store must be hidden from customers');

        const blockedOrd = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: admTestStoreId,
            fulfillment_type: 'pickup',
            items: [{ product_id: admStoreProdId, quantity: 1 }],
            delivery_address: 'Tilak Chowk, Karanja Lad'
          })
        });
        assert.ok(blockedOrd.status === 400 || blockedOrd.status === 403, 'New orders to suspended store must be rejected');

        // Store detail view preserves profile, products, and historical order
        const detRes = await fetch(`${baseUrl}/api/admin/stores/${admTestStoreId}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        });
        assert.strictEqual(detRes.status, 200);
        const det = await detRes.json();
        assert.strictEqual(det.store.id, admTestStoreId);
        assert.ok(det.products.some((p: any) => p.id === admStoreProdId));
        assert.ok(det.orders.some((o: any) => o.id === admStoreOrderId));
      } finally {
        if (admTestStoreId) {
          await storesRepo.update(admTestStoreId, { is_active: false }).catch(() => {});
        }
      }
    });

    // 46. CUSTOMER PII MASKING, ORDER HISTORY & SUSPENSION ENFORCEMENT
    await test('Admin Customer List PII Masking, Order History Endpoint & Suspension Enforcement', async () => {
      const custsRes = await fetch(`${baseUrl}/api/admin/customers`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(custsRes.status, 200);
      const custs = await custsRes.json();
      assert.ok(custs.length > 0);
      const targetCust = custs.find((c: any) => c.id === testCustomerId) || custs[0];
      assert.strictEqual(targetCust.password_hash, undefined, 'password_hash must never be returned');
      assert.ok(targetCust.phone.includes('******'), 'Phone must be masked in admin customers list');

      // Customer Order History endpoint
      const histRes = await fetch(`${baseUrl}/api/admin/customers/${targetCust.id}/orders`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(histRes.status, 200);
      const hist = await histRes.json();
      assert.ok(hist.customer.phone.includes('******'));
      assert.ok(Array.isArray(hist.orders));
      for (const o of hist.orders) {
        assert.strictEqual(o.delivery_otp, undefined, 'delivery_otp must be stripped in admin customer history');
      }

      // Suspend & reactivate a disposable customer account
      const tempPhone = `985${Math.floor(1000000 + Math.random() * 9000000)}`;
      const tempReg = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: tempPhone,
          name: 'Suspend Test Customer',
          password: 'Password@123',
          address: 'Line 2, Karanja Lad'
        })
      });
      const tempCustId = (await tempReg.json()).user.id;

      try {
        const susp = await fetch(`${baseUrl}/api/admin/customers/${tempCustId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: false })
        });
        assert.strictEqual(susp.status, 200);
        const suspendedLogin = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: tempPhone, password: 'Password@123' })
        });
        assert.strictEqual(suspendedLogin.status, 403, 'Suspended customer must be blocked from login');
      } finally {
        await fetch(`${baseUrl}/api/admin/customers/${tempCustId}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: true })
        }).catch(() => {});
      }
    });

    // 47. CATEGORY DEACTIVATE/DELETE SAFETY & ORDERED PRODUCT SOFT-DELETE PROTECTION
    await test('Category Deactivation, Referenced Category Delete Guard & Ordered Product Soft-Deactivation', async () => {
      // Category 1 has seeded/existing products -> DELETE must be blocked (400)
      const delCatRes = await fetch(`${baseUrl}/api/admin/categories/1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(delCatRes.status, 400, 'Deleting category referenced by products must be blocked');

      // Deactivate and reactivate a newly created category safely
      const newCatRes = await fetch(`${baseUrl}/api/admin/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: `Temp Admin Cat ${Date.now()}`, description: 'Test cat', display_order: 99 })
      });
      assert.strictEqual(newCatRes.status, 201);
      const newCatId = (await newCatRes.json()).id;
      try {
        const deactCat = await fetch(`${baseUrl}/api/admin/categories/${newCatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ is_active: false })
        });
        assert.strictEqual(deactCat.status, 200);
        assert.strictEqual((await deactCat.json()).is_active, false);
      } finally {
        await fetch(`${baseUrl}/api/admin/categories/${newCatId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${adminToken}` }
        }).catch(() => {});
      }

      // Soft-delete product referenced in historical order_items (admStoreProdId from Test 45)
      if (admStoreProdId) {
        const delProdRes = await fetch(`${baseUrl}/api/store-owner/products/${admStoreProdId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${admStoreOwnerToken}` }
        });
        assert.strictEqual(delProdRes.status, 200);
        const delProdData = await delProdRes.json();
        assert.strictEqual(delProdData.referenced_in_orders, true, 'Ordered product delete must safely soft-deactivate');
        const storeDetAfter = await (await fetch(`${baseUrl}/api/admin/stores/${admTestStoreId}`, {
          headers: { Authorization: `Bearer ${adminToken}` }
        })).json();
        const histOrder = storeDetAfter.orders.find((o: any) => o.id === admStoreOrderId);
        assert.ok(histOrder && histOrder.items && histOrder.items.length > 0, 'Historical order_items must remain preserved');
      }
    });

    // 48. COMPLAINTS WITH PRODUCT LINKING & ALL 4 STATUSES
    await test('Complaints Linked to Product/Store/Order & All Status Transitions (open -> in_review -> rejected/resolved)', async () => {
      const cRes = await fetch(`${baseUrl}/api/complaints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
        body: JSON.stringify({
          subject: 'Packaging damaged item',
          description: 'Seal was broken on delivery.',
          store_id: admTestStoreId || null,
          order_id: admStoreOrderId || null,
          product_id: admStoreProdId || null
        })
      });
      assert.strictEqual(cRes.status, 201);
      const comp = await cRes.json();
      assert.strictEqual(comp.status, 'open');
      if (admStoreProdId) {
        assert.strictEqual(comp.product_id, admStoreProdId);
        assert.ok(comp.product_name, 'Complaint must enrich product_name');
      }

      for (const nextStatus of ['in_review', 'rejected', 'resolved'] as const) {
        const upRes = await fetch(`${baseUrl}/api/admin/complaints/${comp.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ status: nextStatus, admin_notes: `Admin set ${nextStatus}` })
        });
        assert.strictEqual(upRes.status, 200);
        const updated = await upRes.json();
        assert.strictEqual(updated.status, nextStatus);
      }
    });

    // 49. PLATFORM SETTINGS GOVERNANCE, ADMIN ORDER PII MASKING & AUDIT LOGS
    await test('Admin Platform Settings, Order PII Masking, Service Availability Enforcement & Audit Logs', async () => {
      // Admin /api/orders masks customer_phone and delivery_address
      const admOrders = await (await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })).json();
      assert.ok(Array.isArray(admOrders) && admOrders.length > 0);
      assert.ok(admOrders[0].customer_phone.includes('****'), 'Admin order list must mask customer_phone');
      if (admOrders[0].delivery_address) {
        assert.ok(admOrders[0].delivery_address.includes('*') || admOrders[0].delivery_address.includes('...'), 'Admin order list must mask delivery_address');
      }

      // Public endpoint never exposes monetization flags
      const pubRes = await fetch(`${baseUrl}/api/settings/platform`);
      assert.strictEqual(pubRes.status, 200);
      const pubData = await pubRes.json();
      assert.strictEqual(pubData.monetization_enabled, undefined, 'Public endpoint must never expose monetization flags');
      assert.strictEqual(pubData.subscriptions_enabled, undefined);
      assert.strictEqual(pubData.admob_enabled, undefined);
      assert.strictEqual(pubData.adsense_enabled, undefined);

      // Admin endpoint returns platform & monetization flags (disabled by default)
      const admSetRes = await fetch(`${baseUrl}/api/admin/settings/platform`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(admSetRes.status, 200);
      const admSet = await admSetRes.json();
      assert.strictEqual(admSet.monetization_enabled, false);
      assert.strictEqual(admSet.subscriptions_enabled, false);
      assert.strictEqual(admSet.service_available, true);

      try {
        // Temporarily pause service_available -> POST /api/orders must return 503
        const pauseRes = await fetch(`${baseUrl}/api/admin/settings/platform`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ service_available: false, maintenance_message: 'Scheduled test pause' })
        });
        assert.strictEqual(pauseRes.status, 200);

        const pausedOrder = await fetch(`${baseUrl}/api/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCustomerToken}` },
          body: JSON.stringify({
            store_id: seedStoreId,
            fulfillment_type: 'pickup',
            items: [{ product_id: createdProductId, quantity: 1 }],
            delivery_address: 'Tilak Chowk, Karanja Lad'
          })
        });
        assert.strictEqual(pausedOrder.status, 503, 'Orders must be blocked with 503 when service_available=false');
      } finally {
        await fetch(`${baseUrl}/api/admin/settings/platform`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            service_available: true,
            maintenance_message: 'FMP Supermart is temporarily paused for scheduled maintenance. Please check back shortly.',
            store_visibility_rule: 'approved_active_valid_location',
            monetization_enabled: false,
            subscriptions_enabled: false,
            featured_stores_enabled: false,
            store_ads_enabled: false,
            admob_enabled: false,
            adsense_enabled: false
          })
        }).catch(() => {});
      }

      // Audit logs reflect recent admin actions
      const auditRes = await fetch(`${baseUrl}/api/admin/audit-logs?limit=50`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(auditRes.status, 200);
      const logs = await auditRes.json();
      assert.ok(logs.some((l: any) => l.action === 'PLATFORM_SETTINGS_UPDATED'), 'Audit log must record PLATFORM_SETTINGS_UPDATED');
      assert.ok(logs.some((l: any) => l.action === 'STORE_APPROVAL_UPDATED'), 'Audit log must record STORE_APPROVAL_UPDATED');
    });

    // 50. SECURITY HARDENING: HEADERS, SSRF / UNSAFE IMAGE URL REJECTION, LEGACY JSON SCRUBBING & RATE LIMITING
    await test('Security Hardening: Headers, Unsafe Image URL Blocking, Legacy JSON Scrubbing & Rate Limiting', async () => {
      // 1. Security headers present
      const hdrRes = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(hdrRes.status, 200);
      assert.strictEqual(hdrRes.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(hdrRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.strictEqual(hdrRes.headers.get('x-dns-prefetch-control'), 'off');
      assert.ok(hdrRes.headers.get('permissions-policy')?.includes('geolocation=(self)'));

      // 2. Reject SSRF / private metadata / non-HTTP image URLs on product creation
      const unsafeUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://127.0.0.1:3000/api/admin/stats',
        'http://localhost:8080/secret.png',
        'javascript:alert(1)'
      ];
      for (const badUrl of unsafeUrls) {
        const res = await fetch(`${baseUrl}/api/store-owner/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seedStoreOwnerToken}` },
          body: JSON.stringify({
            name: 'Unsafe Image Test Item',
            category_id: 1,
            unit: 'pack',
            price: 20,
            stock: 5,
            image_url: badUrl
          })
        });
        assert.strictEqual(res.status, 400, `Expected 400 rejecting unsafe image URL: ${badUrl}`);
      }

      // 3. Verify legacy data/fmp_db_state.json holds zero user/order PII or hashes
      const fs = await import('fs');
      const path = await import('path');
      const legacyFile = path.resolve(process.cwd(), 'data', 'fmp_db_state.json');
      if (fs.existsSync(legacyFile)) {
        const parsed = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
        assert.strictEqual(Array.isArray(parsed.users) ? parsed.users.length : -1, 0, 'Legacy JSON users must be empty');
        assert.strictEqual(Array.isArray(parsed.orders) ? parsed.orders.length : -1, 0, 'Legacy JSON orders must be empty');
      }

      // 4. Verify forgot-password rate limiter returns 429 with Retry-After after 6 hits in 15m
      let got429 = false;
      let retryAfterHeader: string | null = null;
      for (let i = 0; i < 8; i++) {
        const rlRes = await fetch(`${baseUrl}/api/auth/forgot-password-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: '9000000000' })
        });
        if (rlRes.status === 429) {
          got429 = true;
          retryAfterHeader = rlRes.headers.get('retry-after');
          break;
        }
      }
      assert.strictEqual(got429, true, 'Rate limiter must return 429 after repeated requests');
      assert.ok(Number(retryAfterHeader) >= 1, '429 response must include positive Retry-After header');
    });

  } finally {
    if (seedStoreId) {
      await storesRepo.update(seedStoreId, { is_active: false }).catch(() => {});
    }
    if (createdProductId) {
      await fetch(`${baseUrl}/api/store-owner/products/${createdProductId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${seedStoreOwnerToken}` }
      }).catch(() => {});
    }
    server.close();
  }

  console.log('\n======================================================');
  console.log(`🎉 Automated Tests Completed: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

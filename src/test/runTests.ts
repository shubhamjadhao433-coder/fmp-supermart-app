import assert from 'node:assert';
import app from '../../server.ts';
import { initDatabase, getDb } from '../server/db.ts';

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
  console.log('======================================================\n');

  // Start test server on random port
  const server = app.listen(0);
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await initDatabase();

    // 1. Health check test
    await test('Health check endpoint returns healthy status and Karanja Lad warehouse config', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.status, 'healthy');
      assert.strictEqual(data.warehouse.location, 'Shivaji Chowk, Karanja Lad, Maharashtra 444105');
      assert.strictEqual(data.businessRules.paymentMode, 'Cash on Delivery (COD) Only');
    });

    // 2. Registration & Login
    let testCustomerToken = '';
    let testCustomerId = 0;
    const uniquePhone = `9823${Math.floor(100000 + Math.random() * 900000)}`;

    await test('Registration and login for new customer in Karanja Lad', async () => {
      // Register
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

      // Login
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

    // 3. Admin & Rider Auth & Permissions (RBAC)
    let adminToken = '';
    let riderToken = '';
    let riderId = 0;

    await test('Admin and rider permissions and RBAC enforcement', async () => {
      // Login as Admin
      const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', password: 'AdminPassword@123' })
      });
      const adminData = await adminLogin.json();
      assert.strictEqual(adminLogin.status, 200);
      assert.strictEqual(adminData.user.role, 'admin');
      adminToken = adminData.token;

      // Login as Rider
      const riderLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9898989898', password: 'RiderPassword@123' })
      });
      const riderData = await riderLogin.json();
      assert.strictEqual(riderLogin.status, 200);
      assert.strictEqual(riderData.user.role, 'rider');
      riderToken = riderData.token;
      riderId = riderData.user.id;

      // Customer should NOT be allowed to access admin routes (e.g. /api/admin/stats)
      const forbiddenRes = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(forbiddenRes.status, 403, 'Customer must be blocked from admin endpoints');

      // Admin CAN access
      const allowedRes = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(allowedRes.status, 200, 'Admin can access stats');
    });

    // 4. Product Management (Add, Edit, Stock Adjust)
    let createdProductId = 0;
    await test('Product management (Admin product creation, editing and stock adjust)', async () => {
      const addRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
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

      // Adjust stock
      const stockRes = await fetch(`${baseUrl}/api/products/${createdProductId}/stock`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ stock: 50, reason: 'Restocked from mandi' })
      });
      const stockData = await stockRes.json();
      assert.strictEqual(stockRes.status, 200);
      assert.strictEqual(stockData.stock, 50);
    });

    // 5. Delivery Charge Calculation Business Rules
    // Rule: < 299 -> ₹25 delivery charge + ₹5 handling
    // Rule: >= 299 -> Free delivery (₹0) + ₹5 handling
    await test('Delivery charge calculations (Below ₹299 vs ₹299+ and handling charge)', async () => {
      // 5a. Order below 299: 1 item of ₹65 (Onions)
      const db = await getDb();
      const pRes = await db.query('SELECT id, price, stock FROM products WHERE price < 200 AND stock > 5 LIMIT 1');
      const testProd = pRes.rows[0];

      const lowOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: testProd.id, quantity: 1 }],
          delivery_address: 'Near Guru Mandir, Karanja Lad'
        })
      });
      const lowOrderData = await lowOrderRes.json();
      assert.strictEqual(lowOrderRes.status, 201);
      assert.strictEqual(Number(lowOrderData.order.delivery_fee), 25, 'Orders under ₹299 must incur ₹25 delivery charge');
      assert.strictEqual(Number(lowOrderData.order.handling_fee), 5, 'Handling fee must be ₹5');
      assert.strictEqual(
        Number(lowOrderData.order.total_amount),
        Number(lowOrderData.order.subtotal) + 25 + 5
      );

      // 5b. Order >= 299: 2 bags of Wheat Flour (2 * 235 = 470)
      const highOrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 2 }], // 2 * 250 = 500 >= 299
          delivery_address: 'Anand Nagar, Karanja Lad'
        })
      });
      const highOrderData = await highOrderRes.json();
      assert.strictEqual(highOrderRes.status, 201);
      assert.strictEqual(Number(highOrderData.order.delivery_fee), 0, 'Orders ₹299 and above must have FREE delivery (₹0)');
      assert.strictEqual(Number(highOrderData.order.handling_fee), 5, 'Handling fee must be ₹5');
      assert.strictEqual(
        Number(highOrderData.order.total_amount),
        Number(highOrderData.order.subtotal) + 5
      );
    });

    // 6. Inventory Reservation and Rollback on Insufficient Stock
    await test('Inventory reservation & rollback (Never allow negative inventory)', async () => {
      const db = await getDb();
      const prodRes = await db.query('SELECT id, stock FROM products WHERE id = $1', [createdProductId]);
      const currentStock = prodRes.rows[0].stock;

      // Attempt to purchase more than available
      const failRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: currentStock + 999 }],
          delivery_address: 'Karanja Main Market'
        })
      });
      assert.strictEqual(failRes.status, 400);
      const failData = await failRes.json();
      assert.ok(failData.error.includes('Insufficient stock'));

      // Check stock was untouched
      const prodAfter = await db.query('SELECT stock FROM products WHERE id = $1', [createdProductId]);
      assert.strictEqual(prodAfter.rows[0].stock, currentStock, 'Stock must not change when order fails');
    });

    // 7. Order Cancellation and Automatic Stock Restoration
    await test('Order cancellation automatically restores reserved stock to inventory', async () => {
      const db = await getDb();
      const prodBefore = await db.query('SELECT stock FROM products WHERE id = $1', [createdProductId]);
      const initialStock = prodBefore.rows[0].stock;

      // Place order for 3 units
      const placeRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 3 }],
          delivery_address: 'Shastri Nagar, Karanja Lad'
        })
      });
      const orderData = await placeRes.json();
      assert.strictEqual(placeRes.status, 201);
      const orderId = orderData.order.id;

      // Stock must be reserved (-3)
      const prodAfterReserve = await db.query('SELECT stock FROM products WHERE id = $1', [createdProductId]);
      assert.strictEqual(prodAfterReserve.rows[0].stock, initialStock - 3);

      // Now cancel order
      const cancelRes = await fetch(`${baseUrl}/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({ reason: 'Ordered by mistake' })
      });
      assert.strictEqual(cancelRes.status, 200);

      // Stock must be restored (+3)
      const prodAfterCancel = await db.query('SELECT stock FROM products WHERE id = $1', [createdProductId]);
      assert.strictEqual(prodAfterCancel.rows[0].stock, initialStock, 'Stock must be fully restored upon cancellation');
    });

    // 8. Complete Customer-to-Delivery Workflow (Rider assignment, secure OTP generation, verification, COD collection)
    await test('Complete customer-to-delivery workflow: Order -> Pack -> Assign Rider -> Dispatch (OTP) -> Deliver -> COD Collection', async () => {
      // 8a. Place order
      const placeRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Guru Mandir Marg, Karanja Lad, Maharashtra 444105'
        })
      });
      const placed = await placeRes.json();
      const orderId = placed.order.id;
      assert.strictEqual(placed.order.status, 'placed');

      // 8b. Admin packs order
      const packRes = await fetch(`${baseUrl}/api/orders/${orderId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ status: 'packed' })
      });
      assert.strictEqual(packRes.status, 200);

      // 8c. Admin assigns rider
      const assignRes = await fetch(`${baseUrl}/api/orders/${orderId}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: riderId })
      });
      assert.strictEqual(assignRes.status, 200);

      // 8d. Admin dispatches order -> Generates secure OTP
      const dispatchRes = await fetch(`${baseUrl}/api/orders/${orderId}/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        }
      });
      assert.strictEqual(dispatchRes.status, 200);

      // 8e. Customer checks order details: Customer-only OTP IS visible to customer
      const custCheck = await fetch(`${baseUrl}/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const custData = await custCheck.json();
      assert.ok(custData.delivery_otp, 'Customer must see their delivery OTP after dispatch');
      const deliveryOtp = custData.delivery_otp;

      // 8f. Rider checks assigned orders: Rider CANNOT see delivery_otp (Security rule)
      const riderOrders = await fetch(`${baseUrl}/api/rider/assigned-orders`, {
        headers: { Authorization: `Bearer ${riderToken}` }
      });
      const riderOrdersData = await riderOrders.json();
      if (!Array.isArray(riderOrdersData)) {
        console.error('Rider orders debug:', riderOrders.status, riderOrdersData);
      }
      const riderOrder = riderOrdersData.find((o: any) => o.id === orderId);
      assert.ok(riderOrder, 'Rider must find order');
      assert.strictEqual(riderOrder.delivery_otp, undefined, 'Delivery OTP must be HIDDEN from rider payload');

      // 8g. Rider tries invalid OTP -> Must be rejected
      const wrongOtpRes = await fetch(`${baseUrl}/api/rider/orders/${orderId}/verify-otp-deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${riderToken}`
        },
        body: JSON.stringify({ otp: '0000' })
      });
      assert.strictEqual(wrongOtpRes.status, 400, 'Invalid OTP must fail');

      // 8h. Rider enters valid OTP provided by customer -> Successful delivery and COD collection
      const deliverRes = await fetch(`${baseUrl}/api/rider/orders/${orderId}/verify-otp-deliver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${riderToken}`
        },
        body: JSON.stringify({ otp: deliveryOtp })
      });
      assert.strictEqual(deliverRes.status, 200);
      const deliverData = await deliverRes.json();
      assert.strictEqual(deliverData.order.status, 'delivered');
      assert.strictEqual(deliverData.order.cod_collected, true);
    });

    // 9. COD Reconciliation & Duplicate Reconciliation Prevention
    await test('COD reconciliation and duplicate reconciliation prevention', async () => {
      // 9a. Check rider unreconciled summary
      const sumRes = await fetch(`${baseUrl}/api/rider/cod-summary`, {
        headers: { Authorization: `Bearer ${riderToken}` }
      });
      const sumData = await sumRes.json();
      console.log('sumData debug:', JSON.stringify(sumData));
      assert.ok(Number(sumData.summary.cash_in_hand) > 0, 'Rider must have cash in hand from delivered order');

      // 9b. Admin reconciles rider COD
      const recRes = await fetch(`${baseUrl}/api/admin/cod-reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          rider_id: riderId,
          notes: 'Handover at Karanja Central Warehouse cash counter'
        })
      });
      assert.strictEqual(recRes.status, 200);
      const recData = await recRes.json();
      assert.ok(recData.reconciliation.reconciliation_number.startsWith('REC-KL-'));

      // 9c. Reconcile again immediately -> Must fail (Prevent duplicate reconciliation)
      const dupRes = await fetch(`${baseUrl}/api/admin/cod-reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: riderId })
      });
      assert.strictEqual(dupRes.status, 400, 'Duplicate reconciliation must be prevented');
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
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Court Road, Karanja Lad, Maharashtra',
          delivery_type: 'scheduled',
          scheduled_date: 'Tomorrow, Oct 31',
          time_slot: '09:00 AM - 12:00 PM (Morning Slot)'
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
      // Toggle favorite on created product
      const favRes = await fetch(`${baseUrl}/api/favorites/${createdProductId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const favData = await favRes.json();
      assert.strictEqual(favRes.status, 200);
      assert.strictEqual(favData.is_favorite, true);

      // Fetch customer favorites
      const getFavRes = await fetch(`${baseUrl}/api/favorites`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const getFavData = await getFavRes.json();
      assert.strictEqual(getFavRes.status, 200);
      const found = getFavData.find((p: any) => p.id === createdProductId);
      assert.ok(found, 'Created product must be in customer favorites list');

      // Toggle off
      const unfavRes = await fetch(`${baseUrl}/api/favorites/${createdProductId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const unfavData = await unfavRes.json();
      assert.strictEqual(unfavData.is_favorite, false);
    });

    // 12. User Review and Rating System
    await test('Product reviews and star rating submission, rating calculation, and admin moderation', async () => {
      // Submit a 5-star review for created product
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

      // Check product reviews & average rating
      const prodRevRes = await fetch(`${baseUrl}/api/products/${createdProductId}/reviews`);
      const prodRevData = await prodRevRes.json();
      assert.strictEqual(prodRevRes.status, 200);
      assert.ok(prodRevData.stats.review_count >= 1);
      assert.strictEqual(prodRevData.stats.average_rating, 5);

      // Admin review moderation: reject review
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

  } finally {
    server.close();
  }

  console.log('\n======================================================');
  console.log(`🎉 Automated Tests Completed: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('======================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

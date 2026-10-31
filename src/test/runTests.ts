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

    // 5. Admin-Controlled Delivery Charge Business Rules
    // Rule: Delivery fee is controlled by admin settings (default ₹25, configurable, ₹0 allowed)
    // Rule: Handling charge is ₹5 per order
    // Rule: Saved permanently with the order record
    await test('Admin-controlled delivery charge & handling fee calculations', async () => {
      // 5a. Order with default delivery fee: 1 item
      const db = await getDb();
      const pRes = await db.query('SELECT id, price, stock FROM products WHERE price < 200 AND stock > 5 LIMIT 1');
      const testProd = pRes.rows[0];

      const orderRes1 = await fetch(`${baseUrl}/api/orders`, {
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
      const orderData1 = await orderRes1.json();
      assert.strictEqual(orderRes1.status, 201);
      assert.strictEqual(Number(orderData1.order.delivery_fee), 25, 'Default delivery fee must be ₹25');
      assert.strictEqual(Number(orderData1.order.handling_fee), 5, 'Handling fee must be ₹5');
      assert.strictEqual(
        Number(orderData1.order.total_amount),
        Number(orderData1.order.subtotal) + 25 + 5
      );

      // 5b. Admin sets promotional delivery fee to ₹0
      const updateFeeRes = await fetch(`${baseUrl}/api/admin/settings/delivery`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          default_delivery_fee: 0,
          handling_fee: 5
        })
      });
      assert.strictEqual(updateFeeRes.status, 200);

      // Order with updated promotional fee ₹0
      const orderRes2 = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Anand Nagar, Karanja Lad'
        })
      });
      const orderData2 = await orderRes2.json();
      assert.strictEqual(orderRes2.status, 201);
      assert.strictEqual(Number(orderData2.order.delivery_fee), 0, 'Admin-configured ₹0 delivery fee must be applied');
      assert.strictEqual(Number(orderData2.order.handling_fee), 5, 'Handling fee must be ₹5');
      assert.strictEqual(
        Number(orderData2.order.total_amount),
        Number(orderData2.order.subtotal) + 5
      );

      // Verify past order 1 fee did NOT shift (permanent record integrity)
      const pastOrderCheck = await fetch(`${baseUrl}/api/orders/${orderData1.order.id}`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const pastOrderData = await pastOrderCheck.json();
      assert.strictEqual(Number(pastOrderData.delivery_fee), 25, 'Past order delivery fee must remain permanently preserved');

      // Reset default delivery fee back to ₹25 for remaining tests
      await fetch(`${baseUrl}/api/admin/settings/delivery`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ default_delivery_fee: 25, handling_fee: 5 })
      });
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

    // 13. Admin Delivery Boy Fleet Management
    await test('Admin delivery rider account creation, password reset, and order reassignment', async () => {
      const newRiderPhone = `9822${Math.floor(100000 + Math.random() * 900000)}`;
      // Create new rider
      const createRiderRes = await fetch(`${baseUrl}/api/admin/riders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          name: 'Vikas Gawande',
          phone: newRiderPhone,
          password: 'RiderSecret@123',
          email: 'vikas.rider@fmpsupermart.in',
          address: 'Station Road, Karanja Lad'
        })
      });
      const createRiderData = await createRiderRes.json();
      assert.strictEqual(createRiderRes.status, 201);
      assert.strictEqual(createRiderData.rider.name, 'Vikas Gawande');
      const newRiderId = createRiderData.rider.id;

      // Reset password for rider
      const resetPassRes = await fetch(`${baseUrl}/api/admin/riders/${newRiderId}/reset-password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ password: 'NewRiderPass@789' })
      });
      assert.strictEqual(resetPassRes.status, 200);

      // Verify new rider can log in with new password
      const riderLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: newRiderPhone, password: 'NewRiderPass@789' })
      });
      assert.strictEqual(riderLoginRes.status, 200);
      const riderLoginData = await riderLoginRes.json();
      assert.strictEqual(riderLoginData.user.role, 'rider');
    });

    // 14. Delivery Slots Management
    await test('Delivery slots listing and capacity management', async () => {
      const slotsRes = await fetch(`${baseUrl}/api/delivery-slots`);
      const slotsData = await slotsRes.json();
      assert.strictEqual(slotsRes.status, 200);
      assert.ok(Array.isArray(slotsData) && slotsData.length >= 1, 'Delivery slots must be available');
      assert.ok(slotsData[0].time_window, 'Slot must have a time window');
    });

    // 15. Admin Individual Order Delivery Charge Management
    await test('Admin individual order delivery fee adjustment (including ₹0) and customer total recalculation', async () => {
      // Place an order
      const orderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Main Market, Karanja Lad'
        })
      });
      const orderData = await orderRes.json();
      assert.strictEqual(orderRes.status, 201);
      const testOrderId = orderData.order.id;
      const initialTotal = Number(orderData.order.total_amount);

      // Admin adjusts delivery charge for this individual order to ₹0
      const feeRes0 = await fetch(`${baseUrl}/api/orders/${testOrderId}/delivery-fee`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ delivery_fee: 0 })
      });
      const feeData0 = await feeRes0.json();
      assert.strictEqual(feeRes0.status, 200);
      assert.strictEqual(Number(feeData0.order.delivery_fee), 0);
      assert.strictEqual(
        Number(feeData0.order.total_amount),
        Number(feeData0.order.subtotal) + 0 + Number(feeData0.order.handling_fee),
        'Total amount must recalculate accurately on backend'
      );

      // Admin sets custom delivery fee of ₹15
      const feeRes15 = await fetch(`${baseUrl}/api/orders/${testOrderId}/delivery-fee`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ delivery_fee: 15 })
      });
      const feeData15 = await feeRes15.json();
      assert.strictEqual(feeRes15.status, 200);
      assert.strictEqual(Number(feeData15.order.delivery_fee), 15);
      assert.strictEqual(
        Number(feeData15.order.total_amount),
        Number(feeData15.order.subtotal) + 15 + Number(feeData15.order.handling_fee)
      );

      // Customer fetches order to verify updated fee and notification
      const custFetch = await fetch(`${baseUrl}/api/orders/${testOrderId}`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      const custOrder = await custFetch.json();
      assert.strictEqual(Number(custOrder.delivery_fee), 15);
    });

    // 16. Inactive Delivery Partner Guard and Order Reassignment
    await test('Inactive rider assignment prevention and order reassignment audit trail', async () => {
      // Create another rider and deactivate them
      const phoneTemp = `9821${Math.floor(100000 + Math.random() * 900000)}`;
      const createRider = await fetch(`${baseUrl}/api/admin/riders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          name: 'Inactive Rider Test',
          phone: phoneTemp,
          password: 'RiderPass@123'
        })
      });
      const rData = await createRider.json();
      const inactiveRiderId = rData.rider.id;

      // Deactivate rider
      await fetch(`${baseUrl}/api/admin/riders/${inactiveRiderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: false })
      });

      // Place order to test assignment
      const orderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: createdProductId, quantity: 1 }],
          delivery_address: 'Subhash Chowk, Karanja Lad'
        })
      });
      const ord = await orderRes.json();
      const orderId = ord.order.id;

      // Attempt assigning order to inactive rider -> MUST BE REJECTED
      const assignInactive = await fetch(`${baseUrl}/api/orders/${orderId}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: inactiveRiderId })
      });
      assert.strictEqual(assignInactive.status, 400);
      const errData = await assignInactive.json();
      assert.ok(errData.error.includes('inactive delivery partner'));

      // Assign to active rider
      const assignActive = await fetch(`${baseUrl}/api/orders/${orderId}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: riderId })
      });
      assert.strictEqual(assignActive.status, 200);

      // Reassign to another active rider
      const reactivateRes = await fetch(`${baseUrl}/api/admin/riders/${inactiveRiderId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ is_active: true })
      });
      assert.strictEqual(reactivateRes.status, 200);

      const reassignRes = await fetch(`${baseUrl}/api/orders/${orderId}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: inactiveRiderId })
      });
      assert.strictEqual(reassignRes.status, 200);
      const reassignData = await reassignRes.json();
      assert.strictEqual(reassignData.rider_id, inactiveRiderId, 'Order must successfully reassign to the new active rider');
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
          role: 'rider' // Attempting to register as rider
        })
      });
      const spoofData = await spoofRes.json();
      assert.strictEqual(spoofRes.status, 201);
      assert.strictEqual(spoofData.user.role, 'customer', 'Public registration role must be customer regardless of input');
    });

    // 18. TEST CASE 1, 2, 3: Single login returns authentic role from PostgreSQL
    await test('Test Cases 1, 2, 3: Automatic role detection via single login (Customer, Admin, Rider)', async () => {
      // 1. Customer login
      const cRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, password: 'TestPassword@123' })
      });
      const cData = await cRes.json();
      assert.strictEqual(cRes.status, 200);
      assert.strictEqual(cData.user.role, 'customer', 'Customer role returned automatically from PostgreSQL');

      // 2. Admin login
      const aRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9876543210', password: 'AdminPassword@123' })
      });
      const aData = await aRes.json();
      assert.strictEqual(aRes.status, 200);
      assert.strictEqual(aData.user.role, 'admin', 'Admin role returned automatically from PostgreSQL');

      // 3. Rider login
      const rRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '9898989898', password: 'RiderPassword@123' })
      });
      const rData = await rRes.json();
      assert.strictEqual(rRes.status, 200);
      assert.strictEqual(rData.user.role, 'rider', 'Rider role returned automatically from PostgreSQL');
    });

    // 19. TEST CASE 4 & 5: Role protection (Customer & Rider blocked from Admin APIs with 403)
    await test('Test Cases 4 & 5: Role protection (Customer cannot access Admin APIs, Rider cannot access Admin APIs)', async () => {
      // Customer tries to access admin reports
      const custAdminRes = await fetch(`${baseUrl}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${testCustomerToken}` }
      });
      assert.strictEqual(custAdminRes.status, 403, 'Customer must receive 403 Forbidden on Admin APIs');

      // Rider tries to access admin reports
      const riderAdminRes = await fetch(`${baseUrl}/api/admin/reports`, {
        headers: { Authorization: `Bearer ${riderToken}` }
      });
      assert.strictEqual(riderAdminRes.status, 403, 'Rider must receive 403 Forbidden on Admin APIs');
    });

    // 20. TEST CASE 6: Customer cannot open another customer's order (403 Forbidden)
    await test("Test Case 6: Customer cannot open another customer's order", async () => {
      // Create second customer
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

      // Customer 2 places an order
      const db = await getDb();
      const p = await db.query('SELECT id FROM products LIMIT 1');
      const c2OrderRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cust2Token}`
        },
        body: JSON.stringify({
          items: [{ product_id: p.rows[0].id, quantity: 1 }],
          delivery_address: 'Guru Mandir Marg, Karanja Lad'
        })
      });
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
      // Without token or cleared token
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

    // 25. DELIVERY PARTNER TIP: Order with tip calculations & rider summary reflection
    await test('Delivery Partner Tip: Calculation during checkout & reflection in Rider summary', async () => {
      const db = await getDb();
      const prodRes = await db.query('SELECT id, price FROM products WHERE stock > 5 LIMIT 1');
      const prod = prodRes.rows[0];
      const tipAmount = 35; // Custom customer tip for rider

      const orderWithTipRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testCustomerToken}`
        },
        body: JSON.stringify({
          items: [{ product_id: prod.id, quantity: 2 }],
          delivery_address: 'Plot 45, Shastri Nagar, Karanja Lad',
          tip_amount: tipAmount
        })
      });
      const tipOrderData = await orderWithTipRes.json();
      assert.strictEqual(orderWithTipRes.status, 201);
      const tipOrder = tipOrderData.order;

      assert.strictEqual(Number(tipOrder.tip_amount), tipAmount, 'Tip amount must be recorded on order');
      const expectedTotal = Number(tipOrder.subtotal) + Number(tipOrder.delivery_fee) + Number(tipOrder.handling_fee) + tipAmount;
      assert.strictEqual(Number(tipOrder.total_amount), expectedTotal, 'Total must securely include tip');

      // Admin assigns this order to rider
      await fetch(`${baseUrl}/api/orders/${tipOrder.id}/assign-rider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ rider_id: riderId })
      });

      // Rider checks assigned orders: tip_amount is visible
      const riderOrdersRes = await fetch(`${baseUrl}/api/rider/assigned-orders`, {
        headers: { Authorization: `Bearer ${riderToken}` }
      });
      const riderOrders = await riderOrdersRes.json();
      const matchedRiderOrder = riderOrders.find((o: any) => o.id === tipOrder.id);
      assert.ok(matchedRiderOrder, 'Order must be assigned to rider');
      assert.strictEqual(Number(matchedRiderOrder.tip_amount), tipAmount, 'Rider must see customer tip amount in their order');
    });

    // 26. ADMIN-ASSISTED FORGOT PASSWORD WORKFLOW
    await test('Admin-assisted forgot password workflow (Zero fake SMS)', async () => {
      // Customer submits forgot password request
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

      // Customer logs in with new password
      const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: uniquePhone, password: 'NewStrongPassword@2026' })
      });
      assert.strictEqual(newLoginRes.status, 200);
      const newLoginData = await newLoginRes.json();
      assert.ok(newLoginData.token, 'Customer successfully logs in with new password');
    });

    // 27. END-TO-END REGISTRATION -> LOGIN -> COD CHECKOUT FLOW (Verify no "User account not found or deactivated" error)
    await test('End-to-End: Customer Registration -> Login -> COD Order Placement', async () => {
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

      // Verify in database that customer is active
      const db = await getDb();
      const dbUserRes = await db.query('SELECT id, phone, role, is_active FROM users WHERE id = $1', [registeredUserId]);
      assert.strictEqual(dbUserRes.rows.length, 1, 'Customer record must exist in PostgreSQL users table');
      assert.notStrictEqual(dbUserRes.rows[0].is_active, false, 'New customer must be active by default');

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

      // Step 4: Customer places COD order
      const prodRes = await db.query('SELECT id, price, stock FROM products WHERE stock >= 2 LIMIT 1');
      const prod = prodRes.rows[0];

      const checkoutRes = await fetch(`${baseUrl}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginData.token}`
        },
        body: JSON.stringify({
          items: [{ product_id: prod.id, quantity: 2 }],
          customer_name: loginData.user.name,
          customer_phone: loginData.user.phone,
          delivery_address: loginData.user.address,
          landmark: 'Near Station Road, Karanja Lad',
          pincode: '444105',
          delivery_type: 'immediate',
          tip_amount: 15
        })
      });

      assert.strictEqual(checkoutRes.status, 201, `Checkout must succeed without error (got status ${checkoutRes.status})`);
      const checkoutData = await checkoutRes.json();
      assert.ok(checkoutData.order, 'Order object must be returned');
      assert.strictEqual(checkoutData.order.customer_id, registeredUserId, 'Order customer_id must match authenticated user ID');
      assert.strictEqual(checkoutData.order.payment_mode, 'COD', 'Payment mode must be COD');
      assert.strictEqual(checkoutData.order.status, 'placed', 'Order status must be placed');
      assert.strictEqual(Number(checkoutData.order.tip_amount), 15, 'Tip amount must be recorded');

      // Step 5: Verify customer can fetch their placed order
      const customerOrdersRes = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${loginData.token}` }
      });
      assert.strictEqual(customerOrdersRes.status, 200);
      const customerOrders = await customerOrdersRes.json();
      const matchedOrder = customerOrders.find((o: any) => o.id === checkoutData.order.id);
      assert.ok(matchedOrder, 'Placed order must appear in customer orders list');
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

import assert from 'node:assert';

process.env.IS_TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';

async function run() {
  console.log('====================================================');
  console.log('🧪 Verifying Customer Registration, Logout & Login');
  console.log('====================================================\n');

  const baseUrl = 'http://127.0.0.1:3000';

  // 1. Generate unique 10-digit mobile number
  const uniquePhone = `99${Math.floor(10000000 + Math.random() * 90000000)}`;
  const testPassword = 'SecurePass@2025';
  const customerName = 'Gaurav Kulkarni';
  const customerAddress = 'Ram Nagar, Near Shivaji Chowk, Karanja Lad';
  const customerLandmark = 'Near Water Tank';

  console.log(`📌 Test Customer: Name="${customerName}", Phone="${uniquePhone}"`);

  // 2. Perform Customer Registration
  console.log('\n[TEST 1] Registering fresh customer...');
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: uniquePhone,
      password: testPassword,
      name: customerName,
      address: customerAddress,
      landmark: customerLandmark
    })
  });

  const regData = await regRes.json();
  assert.strictEqual(regRes.status, 201, `Expected 201 Created, got ${regRes.status}: ${JSON.stringify(regData)}`);
  assert.ok(regData.user, 'Registration must return user');
  assert.strictEqual(regData.user.name, customerName);
  assert.strictEqual(regData.user.phone, uniquePhone);
  assert.strictEqual(regData.user.role, 'customer');
  assert.strictEqual(regData.user.status, 'active', 'User must be active by default');
  assert.strictEqual(regData.user.is_active, true, 'User is_active must be true');
  assert.ok(regData.token, 'Registration must return auth token');
  console.log('✅ Registration succeeded with 201 Created');
  console.log(`   Customer ID in DB: ${regData.user.id}, Status: ${regData.user.status}, Role: ${regData.user.role}`);

  // 3. Test Logout endpoint
  console.log('\n[TEST 2] Calling POST /api/auth/logout...');
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${regData.token}`
    }
  });
  const logoutData = await logoutRes.json();
  assert.strictEqual(logoutRes.status, 200, 'Logout endpoint must respond with 200 OK');
  assert.ok(logoutData.message.includes('Logged out'), 'Logout response must confirm session clearance');
  console.log('✅ Logout API succeeded: ' + logoutData.message);

  // 4. Subsequent Login with the exact same registered mobile and password
  console.log('\n[TEST 3] Logging in with the registered credentials...');
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: uniquePhone,
      password: testPassword
    })
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, `Expected 200 OK, got ${loginRes.status}: ${JSON.stringify(loginData)}`);
  assert.ok(loginData.token, 'Login must issue JWT token');
  assert.strictEqual(loginData.user.id, regData.user.id, 'User ID must match database record');
  assert.strictEqual(loginData.user.phone, uniquePhone);
  assert.strictEqual(loginData.user.name, customerName);
  assert.strictEqual(loginData.user.status, 'active');
  assert.strictEqual(loginData.user.is_active, true);
  console.log('✅ Subsequent Login succeeded! Token issued and customer profile returned.');

  // 5. Verify /api/auth/me session with the new token
  console.log('\n[TEST 4] Verifying session with GET /api/auth/me...');
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${loginData.token}` }
  });
  const meData = await meRes.json();
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meData.user.id, regData.user.id);
  assert.strictEqual(meData.user.phone, uniquePhone);
  console.log('✅ Session active: authenticated as ' + meData.user.name);

  // 6. Verify phone normalization on login (with +91 and spaces)
  console.log('\n[TEST 5] Testing Login with +91 country prefix and spaces...');
  const formattedPhone = `+91 ${uniquePhone.slice(0, 5)} ${uniquePhone.slice(5)}`;
  const loginFormattedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: formattedPhone,
      password: testPassword
    })
  });
  assert.strictEqual(loginFormattedRes.status, 200, 'Login with +91 and spaces must succeed seamlessly');
  console.log(`✅ Login with formatted mobile ("${formattedPhone}") succeeded seamlessly`);

  // 7. Negative test: Wrong password
  console.log('\n[TEST 6] Testing Login with incorrect password...');
  const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: uniquePhone,
      password: 'WrongPassword@999'
    })
  });
  assert.strictEqual(wrongPassRes.status, 401, 'Wrong password must return 401 Unauthorized');
  const wrongPassData = await wrongPassRes.json();
  console.log('✅ Wrong password rejected with 401: ' + wrongPassData.error);

  // 8. Negative test: Duplicate registration protection
  console.log('\n[TEST 7] Testing Duplicate registration prevention...');
  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: uniquePhone,
      password: testPassword,
      name: 'Duplicate Attempt'
    })
  });
  assert.strictEqual(dupRes.status, 400, 'Duplicate phone registration must return 400');
  const dupData = await dupRes.json();
  console.log('✅ Duplicate registration rejected with 400: ' + dupData.error);

  console.log('\n====================================================');
  console.log('🎉 ALL 7 TESTS PASSED SUCCESSFULLY WITH REAL POSTGRESQL BACKEND!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

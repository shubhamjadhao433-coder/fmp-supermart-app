import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

process.env.IS_TEST_SUITE = 'true';
process.env.NODE_ENV = 'test';

async function run() {
  console.log('===================================================================');
  console.log('🧪 Testing: Customer Registration -> Logout -> Login Flow Verification');
  console.log('===================================================================\n');

  const baseUrl = 'http://127.0.0.1:3000';

  // Generate unique test credentials
  const phone = `97${Math.floor(10000000 + Math.random() * 90000000)}`;
  const password = 'CustomerPass@2026';
  const name = 'Vikas Shinde';
  const address = 'Near APMC Market, Karanja Lad';
  const landmark = 'Market Yard';

  console.log(`👤 New Customer Credentials: Phone=${phone}, Password=${password}, Name=${name}`);

  // Step 1: Register Customer
  console.log('\n[Step 1] Customer creates an account (POST /api/auth/register)...');
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      password,
      name,
      address,
      landmark,
      role: 'customer'
    })
  });

  const regData = await regRes.json();
  assert.strictEqual(regRes.status, 201, `Registration failed: ${JSON.stringify(regData)}`);
  assert.ok(regData.token, 'Token must be returned');
  assert.strictEqual(regData.user.phone, phone);
  assert.strictEqual(regData.user.name, name);
  console.log('✅ Customer account created successfully! User ID:', regData.user.id);

  // Step 2: Customer logs out
  console.log('\n[Step 2] Customer logs out (POST /api/auth/logout)...');
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${regData.token}`
    }
  });
  const logoutData = await logoutRes.json();
  assert.strictEqual(logoutRes.status, 200);
  console.log('✅ Logged out successfully:', logoutData.message);

  // Step 3: Customer logs back in using the exact same mobile and password
  console.log('\n[Step 3] Customer logs back in with same mobile and password (POST /api/auth/login)...');
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      password
    })
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginData)}`);
  assert.ok(loginData.token, 'New session token must be issued on login');
  assert.strictEqual(loginData.user.id, regData.user.id, 'User ID must match registered account');
  assert.strictEqual(loginData.user.phone, phone);
  assert.strictEqual(loginData.user.name, name);
  console.log('✅ Logged in successfully! Authenticated as:', loginData.user.name);

  // Step 4: Verify Session via GET /api/auth/me
  console.log('\n[Step 4] Verifying authenticated session (GET /api/auth/me)...');
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${loginData.token}` }
  });
  const meData = await meRes.json();
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meData.user.id, regData.user.id);
  console.log('✅ Active session confirmed for customer:', meData.user.name);

  // Step 5: Test login with country code variations
  console.log('\n[Step 5] Testing Login with +91 and leading 0 formats...');
  const withPlus91 = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
      password
    })
  });
  assert.strictEqual(withPlus91.status, 200, 'Login with +91 format must succeed');

  const withZero = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: `0${phone}`,
      password
    })
  });
  assert.strictEqual(withZero.status, 200, 'Login with leading 0 format must succeed');
  console.log('✅ Country code and formatting variations accepted seamlessly!');

  // Step 6: Verify disk persistence file
  console.log('\n[Step 6] Verifying persistence snapshot on disk...');
  const stateFile = path.resolve(process.cwd(), 'data', 'fmp_db_state.json');
  assert.ok(fs.existsSync(stateFile), 'State file data/fmp_db_state.json must exist');
  const diskState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  const foundInDisk = diskState.users?.find((u: any) => u.phone === phone);
  assert.ok(foundInDisk, 'Registered customer must be stored in persistence snapshot');
  console.log('✅ Verified customer persists in data/fmp_db_state.json (Survives server restarts)!');

  console.log('\n===================================================================');
  console.log('🎉 REGISTRATION -> LOGOUT -> LOGIN COMPLETE FLOW VERIFIED 100%!');
  console.log('===================================================================\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

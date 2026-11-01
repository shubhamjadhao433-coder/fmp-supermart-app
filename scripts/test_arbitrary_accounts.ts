/**
 * FMP Supermart - Arbitrary Accounts Verification Script
 * Proves that customer registration and admin-created rider accounts work
 * with ANY valid unique 10-digit mobile number and password in PostgreSQL.
 */

const BASE_URL = 'http://localhost:3000';

interface VerificationRecord {
  scenario: string;
  role: string;
  phone: string;
  status: 'PASSED' | 'FAILED';
  dbRecord: any;
}

const records: VerificationRecord[] = [];

async function testArbitraryAccounts() {
  console.log('================================================================');
  console.log('TESTING ARBITRARY UNIQUE ACCOUNTS IN POSTGRESQL');
  console.log('================================================================\n');

  const uid = Date.now().toString().slice(-6);

  // -------------------------------------------------------------
  // TEST 1: Customer A with arbitrary mobile and password
  // -------------------------------------------------------------
  const custA = {
    name: `Ramesh Shinde ${uid}`,
    phone: `9823${uid.slice(0, 6)}`,
    password: `Ramesh@Karanja${uid}`,
    email: `ramesh.${uid}@karanjamart.in`,
    address: `House 12, Shivaji Chowk, Karanja Lad`,
    landmark: `Near Bank of Maharashtra`,
    pincode: `444105`
  };

  console.log(`[TEST 1] Registering Customer A: ${custA.name} (${custA.phone})...`);
  const regARes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(custA)
  });
  const regAData = await regARes.json();
  if (!regARes.ok || !regAData.user?.id) {
    throw new Error(`Customer A registration failed: ${JSON.stringify(regAData)}`);
  }
  const custAId = regAData.user.id;
  const custAToken = regAData.token;

  // Test Customer A login with exact registered credentials
  console.log(`[TEST 1] Customer A Logging in with ${custA.phone} and ${custA.password}...`);
  const loginARes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: custA.phone, password: custA.password })
  });
  const loginAData = await loginARes.json();
  if (!loginARes.ok || loginAData.user?.id !== custAId) {
    throw new Error(`Customer A login failed: ${JSON.stringify(loginAData)}`);
  }

  // Verify session endpoint
  const meARes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginAData.token}` }
  });
  const meAData = await meARes.json();
  records.push({
    scenario: 'Customer A Arbitrary Registration & Login',
    role: 'customer',
    phone: custA.phone,
    status: meARes.ok && meAData.user?.phone === custA.phone ? 'PASSED' : 'FAILED',
    dbRecord: meAData.user
  });
  console.log(`✓ Customer A verified in PostgreSQL (ID: ${custAId}, Phone: ${custA.phone})\n`);

  // -------------------------------------------------------------
  // TEST 2: Customer B with completely different number & complex password
  // -------------------------------------------------------------
  const custB = {
    name: `Sunita Deshpande ${uid}`,
    phone: `9421${uid}`,
    password: `Sunita#Supermart!${uid}`,
    email: `sunita.${uid}@karanjamart.in`,
    address: `Plot 7, Anand Nagar, Karanja Lad`,
    landmark: `Near Datta Mandir`,
    pincode: `444105`
  };

  console.log(`[TEST 2] Registering Customer B: ${custB.name} (${custB.phone})...`);
  const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(custB)
  });
  const regBData = await regBRes.json();
  if (!regBRes.ok || !regBData.user?.id) {
    throw new Error(`Customer B registration failed: ${JSON.stringify(regBData)}`);
  }
  const custBId = regBData.user.id;

  // Test Customer B login
  console.log(`[TEST 2] Customer B Logging in with ${custB.phone}...`);
  const loginBRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: custB.phone, password: custB.password })
  });
  const loginBData = await loginBRes.json();
  if (!loginBRes.ok || loginBData.user?.id !== custBId) {
    throw new Error(`Customer B login failed: ${JSON.stringify(loginBData)}`);
  }

  records.push({
    scenario: 'Customer B Arbitrary Registration & Login',
    role: 'customer',
    phone: custB.phone,
    status: loginBRes.ok ? 'PASSED' : 'FAILED',
    dbRecord: loginBData.user
  });
  console.log(`✓ Customer B verified in PostgreSQL (ID: ${custBId}, Phone: ${custB.phone})\n`);

  // -------------------------------------------------------------
  // TEST 3: Admin Creates Delivery Partner Rider 1
  // -------------------------------------------------------------
  console.log('[TEST 3] Admin Logging In...');
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9699925206', password: 'test@12345' })
  });
  const adminLoginData = await adminLoginRes.json();
  const adminToken = adminLoginData.token;

  const rider1 = {
    name: `Sachin Jadhav ${uid} (Express Fleet)`,
    phone: `9922${uid}`,
    password: `Sachin@Fleet${uid}`,
    address: `Behind Bus Stand, Karanja Lad`
  };

  console.log(`[TEST 3] Admin creating Delivery Partner 1: ${rider1.name} (${rider1.phone})...`);
  const rider1Res = await fetch(`${BASE_URL}/api/admin/riders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(rider1)
  });
  const rider1Data = await rider1Res.json();
  if (!rider1Res.ok || !rider1Data.rider?.id) {
    throw new Error(`Rider 1 creation failed: ${JSON.stringify(rider1Data)}`);
  }
  const rider1Id = rider1Data.rider.id;

  // Rider 1 logs in with assigned credentials
  console.log(`[TEST 3] Delivery Partner 1 logging in with ${rider1.phone}...`);
  const rider1LoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: rider1.phone, password: rider1.password })
  });
  const rider1LoginData = await rider1LoginRes.json();
  if (!rider1LoginRes.ok || rider1LoginData.user?.role !== 'rider' || rider1LoginData.user?.id !== rider1Id) {
    throw new Error(`Rider 1 login failed: ${JSON.stringify(rider1LoginData)}`);
  }

  records.push({
    scenario: 'Delivery Partner 1 Admin Creation & Login',
    role: 'rider',
    phone: rider1.phone,
    status: rider1LoginRes.ok ? 'PASSED' : 'FAILED',
    dbRecord: rider1LoginData.user
  });
  console.log(`✓ Delivery Partner 1 verified in PostgreSQL (ID: ${rider1Id}, Phone: ${rider1.phone})\n`);

  // -------------------------------------------------------------
  // TEST 4: Admin Creates Delivery Partner Rider 2 (Different details)
  // -------------------------------------------------------------
  const rider2 = {
    name: `Kiran Wankhede ${uid} (Ward 4)`,
    phone: `9158${uid}`,
    password: `Kiran#Delivery${uid}`,
    address: `Station Road, Karanja Lad`
  };

  console.log(`[TEST 4] Admin creating Delivery Partner 2: ${rider2.name} (${rider2.phone})...`);
  const rider2Res = await fetch(`${BASE_URL}/api/admin/riders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify(rider2)
  });
  const rider2Data = await rider2Res.json();
  if (!rider2Res.ok || !rider2Data.rider?.id) {
    throw new Error(`Rider 2 creation failed: ${JSON.stringify(rider2Data)}`);
  }
  const rider2Id = rider2Data.rider.id;

  // Rider 2 logs in with assigned credentials
  console.log(`[TEST 4] Delivery Partner 2 logging in with ${rider2.phone}...`);
  const rider2LoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: rider2.phone, password: rider2.password })
  });
  const rider2LoginData = await rider2LoginRes.json();
  if (!rider2LoginRes.ok || rider2LoginData.user?.role !== 'rider' || rider2LoginData.user?.id !== rider2Id) {
    throw new Error(`Rider 2 login failed: ${JSON.stringify(rider2LoginData)}`);
  }

  records.push({
    scenario: 'Delivery Partner 2 Admin Creation & Login',
    role: 'rider',
    phone: rider2.phone,
    status: rider2LoginRes.ok ? 'PASSED' : 'FAILED',
    dbRecord: rider2LoginData.user
  });
  console.log(`✓ Delivery Partner 2 verified in PostgreSQL (ID: ${rider2Id}, Phone: ${rider2.phone})\n`);

  // -------------------------------------------------------------
  // TEST 5: Negative Security Checks
  // -------------------------------------------------------------
  console.log('[TEST 5] Testing Incorrect Password & Duplicate Phone Constraints...');
  
  // Wrong password test
  const wrongPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: custA.phone, password: 'WrongPassword999!' })
  });
  const wrongPassData = await wrongPassRes.json();
  const wrongPassBlocked = wrongPassRes.status === 401 && wrongPassData.error?.includes('Incorrect password');

  // Duplicate registration test
  const dupRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Duplicate Phone User',
      phone: custA.phone,
      password: 'AnyPassword@123'
    })
  });
  const dupRegBlocked = dupRegRes.status === 400;

  // Invalid short phone test (<10 digits)
  const shortPhoneRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Short Phone User',
      phone: '9822123',
      password: 'AnyPassword@123'
    })
  });
  const shortPhoneBlocked = shortPhoneRes.status === 400;

  records.push({
    scenario: 'Negative Security & Integrity Enforcement',
    role: 'security',
    phone: 'various',
    status: wrongPassBlocked && dupRegBlocked && shortPhoneBlocked ? 'PASSED' : 'FAILED',
    dbRecord: {
      wrongPasswordRejected: wrongPassBlocked,
      duplicatePhoneRejected: dupRegBlocked,
      shortPhoneRejected: shortPhoneBlocked
    }
  });

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('ARBITRARY ACCOUNT VERIFICATION RESULTS IN POSTGRESQL');
  console.log('================================================================');
  console.log(JSON.stringify(records, null, 2));

  const allPassed = records.every(r => r.status === 'PASSED');
  if (!allPassed) {
    console.error('Some tests failed!');
    process.exit(1);
  } else {
    console.log('\nALL 5 ARBITRARY ACCOUNT SCENARIOS PASSED WITH ACTUAL POSTGRESQL RECORDS!');
    process.exit(0);
  }
}

testArbitraryAccounts().catch(err => {
  console.error('Fatal testing error:', err);
  process.exit(1);
});

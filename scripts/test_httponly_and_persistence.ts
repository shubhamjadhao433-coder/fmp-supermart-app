/**
 * Verification test for HttpOnly cookie compatibility and session persistence across refresh.
 */
import app from '../server.ts';
import { initDatabase, getDb } from '../src/server/db.ts';

async function run() {
  console.log('===================================================================');
  console.log('🧪 Verifying JWT Storage, HttpOnly Cookie & Session Persistence');
  console.log('===================================================================');

  await initDatabase();
  const db = await getDb();

  // Pick unique customer mobile
  const testPhone = '9766' + Math.floor(100000 + Math.random() * 900000);
  const testPassword = 'SecurePassword@2026';
  const testName = 'Pooja Deshmukh';

  // Start temporary server instance to make real HTTP calls
  const server = app.listen(0);
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Register new customer
    console.log('\n[Check 1] Customer Registration & Cookie Emission...');
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        password: testPassword,
        name: testName,
        address: 'Shivaji Chowk, Karanja Lad',
        landmark: 'Near Guru Mandir'
      })
    });

    if (regRes.status !== 201) {
      throw new Error(`Registration failed with status ${regRes.status}: ${await regRes.text()}`);
    }

    const regData = await regRes.json();
    const regSetCookie = regRes.headers.get('set-cookie');
    console.log('  -> JWT Token received in JSON:', Boolean(regData.token));
    console.log('  -> Set-Cookie Header present:', Boolean(regSetCookie));
    console.log('  -> Set-Cookie Content:', regSetCookie);

    if (!regData.token) throw new Error('Missing token in registration response');
    if (!regSetCookie || !regSetCookie.includes('HttpOnly')) {
      throw new Error('Registration did not emit HttpOnly cookie');
    }
    console.log('  ✅ Check 1 Passed: Registration returns token + HttpOnly cookie');

    // 2. Login with registered customer
    console.log('\n[Check 2] Customer Login & Cookie Emission...');
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        password: testPassword
      })
    });

    if (loginRes.status !== 200) {
      throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
    }

    const loginData = await loginRes.json();
    const loginSetCookie = loginRes.headers.get('set-cookie');
    console.log('  -> User logged in:', loginData.user.name, `(${loginData.user.role})`);
    console.log('  -> Set-Cookie Header present:', Boolean(loginSetCookie));

    if (!loginSetCookie || !loginSetCookie.includes('HttpOnly')) {
      throw new Error('Login did not emit HttpOnly cookie');
    }

    // Extract cookie value for testing
    const cookieMatch = loginSetCookie.match(/token=([^;]+)/);
    const tokenFromCookie = cookieMatch ? cookieMatch[1] : '';
    console.log('  ✅ Check 2 Passed: Login emits secure HttpOnly cookie and JSON token');

    // 3. Test Authentication via HttpOnly Cookie ONLY (No Authorization header)
    console.log('\n[Check 3] Session Revalidation using Cookie ONLY (Browser refresh simulation)...');
    const cookieOnlyRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': `token=${tokenFromCookie}`
      }
    });

    if (cookieOnlyRes.status !== 200) {
      throw new Error(`Cookie-only /api/auth/me failed with status ${cookieOnlyRes.status}: ${await cookieOnlyRes.text()}`);
    }

    const cookieMeData = await cookieOnlyRes.json();
    console.log('  -> Authenticated via Cookie as:', cookieMeData.user.name, `(ID: ${cookieMeData.user.id})`);
    if (cookieMeData.user.phone !== testPhone) {
      throw new Error('User phone does not match session');
    }
    console.log('  ✅ Check 3 Passed: HttpOnly cookie allows full session revalidation on refresh');

    // 4. Test Authentication via Bearer Token ONLY (No Cookie header)
    console.log('\n[Check 4] Session Revalidation using Bearer Token ONLY...');
    const bearerOnlyRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${loginData.token}`
      }
    });

    if (bearerOnlyRes.status !== 200) {
      throw new Error(`Bearer-only /api/auth/me failed with status ${bearerOnlyRes.status}: ${await bearerOnlyRes.text()}`);
    }

    const bearerMeData = await bearerOnlyRes.json();
    console.log('  -> Authenticated via Bearer as:', bearerMeData.user.name);
    console.log('  ✅ Check 4 Passed: Bearer token verification works flawlessly');

    // 5. Test Logout clears the cookie
    console.log('\n[Check 5] Logout clears HttpOnly Cookie...');
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST'
    });

    const logoutSetCookie = logoutRes.headers.get('set-cookie');
    console.log('  -> Logout Set-Cookie Header:', logoutSetCookie);
    if (!logoutSetCookie || (!logoutSetCookie.includes('token=;') && !logoutSetCookie.includes('Expires=Thu, 01 Jan 1970'))) {
      throw new Error('Logout did not clear token cookie');
    }
    console.log('  ✅ Check 5 Passed: Logout properly invalidates cookie');

    // 6. Test Admin and Delivery Boy Roles with HttpOnly Cookie
    console.log('\n[Check 6] Admin and Rider Role-based Cookie Authentication...');
    const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '9699925206',
        password: 'test@12345'
      })
    });
    if (adminLoginRes.status !== 200) {
      throw new Error(`Admin login failed: ${await adminLoginRes.text()}`);
    }
    const adminCookie = adminLoginRes.headers.get('set-cookie')?.match(/token=([^;]+)/)?.[1];

    const adminStatsRes = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { 'Cookie': `token=${adminCookie}` }
    });
    if (adminStatsRes.status !== 200) {
      throw new Error(`Admin stats failed via cookie: ${await adminStatsRes.text()}`);
    }
    console.log('  ✅ Check 6 Passed: Admin dashboard APIs accessible via HttpOnly session cookie');

    console.log('\n===================================================================');
    console.log('🎉 ALL 6 CHECKS PASSED: HttpOnly & Session Persistence 100% OPERATIONAL!');
    console.log('===================================================================');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});

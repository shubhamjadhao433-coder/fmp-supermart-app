import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import {
  firestoreDb,
  seedFirestoreIfEmpty,
  usersRepo,
  categoriesRepo,
  productsRepo,
  ordersRepo,
  settingsRepo,
  notificationsRepo,
  favoritesRepo,
  reviewsRepo,
  auditLogsRepo,
  passwordResetsRepo,
  storesRepo,
  complaintsRepo,
  addressesRepo,
  UserDoc,
  OrderDoc,
  StoreDoc,
  sanitizeProductForCustomer
} from './src/server/firestoreDb.ts';
import {
  requireAuth,
  requireRole,
  generateToken,
  logAudit,
  generatePickupCode,
  AuthenticatedRequest
} from './src/server/auth.ts';
import {
  calculateRoadDistanceKm,
  calculateHaversineKm,
  isValidCoordinate,
  normalizeDeliverySlabs
} from './src/server/deliveryDistance.ts';
import {
  searchOsmLocations,
  reverseGeocodeOsm
} from './src/server/osmGeocoding.ts';
import {
  normalizeProductType,
  validateAdminPriceSlabs,
  resolveProductQuantityPricing
} from './src/shared/quantityPricing.ts';
import { collection, getDocs } from 'firebase/firestore';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT ? Number(process.env.PORT) : 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

function getRequestExpectedOrigins(req: Request): string[] {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!rawHost) return [];
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim().toLowerCase();
  const origins = [`${proto}://${rawHost}`];
  if (proto !== 'https') origins.push(`https://${rawHost}`);
  if (proto !== 'http') origins.push(`http://${rawHost}`);
  return origins;
}

function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return IS_PRODUCTION || req.secure || forwardedProto === 'https';
}

function getAuthCookieOptions(req: Request, includeMaxAge: boolean) {
  const secureCtx = isHttpsRequest(req);
  return {
    httpOnly: true,
    secure: secureCtx,
    sameSite: (secureCtx ? 'none' : 'lax') as 'none' | 'lax',
    ...(secureCtx ? { partitioned: true } : {}),
    path: '/',
    ...(includeMaxAge ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {})
  };
}

function setAuthCookie(req: Request, res: Response, token: string): void {
  res.cookie('token', token, getAuthCookieOptions(req, true));
}

function clearAuthCookie(req: Request, res: Response): void {
  res.clearCookie('token', getAuthCookieOptions(req, false));
}

function getClientIp(req: Request): string {
  return req.ip || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(scope: string, maxRequests: number, windowMs: number, message: string) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${scope}:${getClientIp(req)}`;
    const recent = (hits.get(key) || []).filter(ts => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, list] of hits.entries()) {
        if (list.every(ts => now - ts >= windowMs)) hits.delete(k);
      }
    }
    next();
  };
}

const authLoginLimiter = createRateLimiter(
  'auth_login',
  35,
  15 * 60 * 1000,
  'Too many login attempts from this IP. Please wait 15 minutes and try again.'
);
const authRegisterLimiter = createRateLimiter(
  'auth_register',
  25,
  15 * 60 * 1000,
  'Too many registration requests from this IP. Please try again later.'
);
const storeRegisterLimiter = createRateLimiter(
  'store_register',
  20,
  15 * 60 * 1000,
  'Too many store registration attempts. Please try again later.'
);
const forgotPasswordLimiter = createRateLimiter(
  'forgot_password',
  6,
  15 * 60 * 1000,
  'Too many password reset requests. Please wait before trying again.'
);
const orderCreateLimiter = createRateLimiter(
  'order_create',
  60,
  15 * 60 * 1000,
  'Too many order submissions in a short window. Please wait a moment.'
);
const locationLookupLimiter = createRateLimiter(
  'location_lookup',
  90,
  15 * 60 * 1000,
  'Too many location searches. Please wait a moment before searching again.'
);

function safeServerError(err: any, fallback = 'An unexpected server error occurred. Please try again.'): string {
  if (IS_PRODUCTION) return fallback;
  return err?.message || fallback;
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (!origin) {
    return next();
  }
  const expectedOrigins = allowedOrigins.length > 0 ? allowedOrigins : getRequestExpectedOrigins(req);
  if (IS_PRODUCTION && !expectedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed by CORS' });
  }
  return cors({
    origin: true,
    credentials: true
  })(req, res, next);
});

// Baseline security headers & CSRF origin check for cookie-authenticated mutating requests
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (isHttpsRequest(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (IS_PRODUCTION && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const hasCookie = Boolean(req.headers.cookie);
    if (!hasBearer && hasCookie) {
      const originHeader = String(req.headers.origin || req.headers.referer || '').trim();
      const expectedOrigins = allowedOrigins.length > 0 ? allowedOrigins : getRequestExpectedOrigins(req);
      const originAllowed = expectedOrigins.some(o => originHeader === o || originHeader.startsWith(`${o}/`));
      if (!originAllowed) {
        return res.status(403).json({ error: 'Cross-origin state-changing request blocked.' });
      }
    }
  }
  next();
});

app.use(express.json({ limit: '2mb' }));

// Serve public directory for PWA assets, manifest, and icons (works in dev tsx and bundled dist/server.js)
const publicDirPath =
  [
    path.resolve(__dirname, 'public'),
    path.resolve(process.cwd(), 'public'),
    path.resolve(__dirname, '..', 'public')
  ].find(p => fs.existsSync(p)) || path.resolve(__dirname, 'public');
app.get(['/manifest.json', '/manifest.webmanifest'], (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(publicDirPath, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.resolve(publicDirPath, 'sw.js'));
});

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getBaseSiteUrl(req: Request): string {
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, '');
}

app.get('/robots.txt', (req: Request, res: Response) => {
  const baseUrl = getBaseSiteUrl(req);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /admin',
      `Sitemap: ${baseUrl}/sitemap.xml`,
      ''
    ].join('\n')
  );
});

app.get('/sitemap.xml', async (req: Request, res: Response) => {
  try {
    const baseUrl = getBaseSiteUrl(req);
    const [stores, categories] = await Promise.all([
      storesRepo.listApprovedActive().catch(() => []),
      categoriesRepo.list().catch(() => [])
    ]);
    const nowIso = new Date().toISOString();
    const urls: Array<{ loc: string; lastmod: string; changefreq: string; priority: string }> = [
      { loc: `${baseUrl}/`, lastmod: nowIso, changefreq: 'daily', priority: '1.0' }
    ];
    for (const cat of categories) {
      if (cat.slug) {
        urls.push({
          loc: `${baseUrl}/?category=${encodeURIComponent(cat.slug)}`,
          lastmod: nowIso,
          changefreq: 'weekly',
          priority: '0.7'
        });
      }
    }
    for (const st of stores) {
      urls.push({
        loc: `${baseUrl}/?store=${encodeURIComponent(String(st.id))}`,
        lastmod: st.updated_at || st.created_at || nowIso,
        changefreq: 'daily',
        priority: '0.8'
      });
    }
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        u =>
          `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      ),
      '</urlset>'
    ].join('\n');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch {
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8').send('Unable to generate sitemap');
  }
});

app.use(express.static(publicDirPath));

// Initialize Firestore collections & default seeds
let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await seedFirestoreIfEmpty();
    dbInitialized = true;
  }
}

// Ensure DB is ready on request
app.use(async (req, res, next) => {
  try {
    await ensureDb();
  } catch (err: any) {
    console.warn('[Firestore] Initialization notice:', err?.message || err);
  }
  next();
});

// ----------------------------------------------------
// Health Check Endpoint (Pure Firestore Single Source of Truth)
// ----------------------------------------------------
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const userCount = await usersRepo.count();

    res.json({
      status: 'healthy',
      app: 'FMP Supermart',
      coverage: 'India-Wide Hyperlocal Marketplace',
      timestamp: new Date().toISOString(),
      database: {
        healthy: true,
        type: 'Firebase Firestore (Single Source of Truth)',
        is_external: true,
        configured_source: 'firebase-applet-config.json',
        masked_host: 'firestore.googleapis.com',
        users_count: userCount,
        serverless_safe: true,
        warning: null
      },
      businessRules: {
        deliveryFeeModel: 'Store-Managed Delivery & Free Store Pickup',
        handlingCharge: 0,
        paymentMode: 'Cash on Delivery (COD) & Pay at Store',
        marketplaceMode: 'India-Wide Hyperlocal Multi-Store Grocery Marketplace'
      }
    });
  } catch (err: any) {
    res.status(500).json({ status: 'unhealthy', error: safeServerError(err, 'Health check failed.') });
  }
});

// ----------------------------------------------------
// Authentication Helpers & Endpoints
// ----------------------------------------------------
function normalizePhone(rawPhone: any): string {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).trim().replace(/\D/g, '');
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

function isDisallowedImageHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    /^\d+$/.test(host)
  ) {
    return true;
  }
  if (/^fc[0-9a-f]{2}:|^fd[0-9a-f]{2}:|^fe80:/i.test(host)) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }
  return false;
}

function sanitizeImageValue(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    if (trimmed.length > 350000) {
      throw new Error('Uploaded image is too large. Please choose a smaller image.');
    }
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Invalid image URL format.');
    }
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
      throw new Error('Image URL host or format is not allowed.');
    }
    if (isDisallowedImageHost(parsed.hostname)) {
      throw new Error('Image URL host is not allowed.');
    }
    return parsed.toString().slice(0, 1500);
  }
  throw new Error('Image must be a valid HTTPS/HTTP URL or PNG/JPG/WebP upload.');
}

function sanitizeStorePhotos(rawPhotos: unknown): string[] {
  if (!Array.isArray(rawPhotos)) return [];
  const out: string[] = [];
  for (const item of rawPhotos.slice(0, 4)) {
    const clean = sanitizeImageValue(item);
    if (clean) out.push(clean);
  }
  return out;
}

function sanitizePublicStore(
  store: StoreDoc,
  extra?: { distance_km?: number | null; product_count?: number; available_product_names?: string[] }
) {
  return {
    id: store.id,
    name: store.name,
    description: store.description || null,
    email: store.email || null,
    address: store.address,
    landmark: store.landmark || null,
    city: store.city || '',
    district: store.district || null,
    state: store.state || null,
    pincode: store.pincode || '',
    lat: store.lat,
    lng: store.lng,
    logo_url: store.logo_url || null,
    banner_url: store.banner_url || null,
    photos: Array.isArray(store.photos) ? store.photos : [],
    opening_hours: store.opening_hours,
    opening_time: store.opening_time || null,
    closing_time: store.closing_time || null,
    weekly_closed_days: Array.isArray(store.weekly_closed_days) ? store.weekly_closed_days : [],
    service_type: store.service_type,
    delivery_radius_km: store.delivery_radius_km,
    delivery_fee: store.delivery_fee,
    min_order_amount: store.min_order_amount,
    delivery_info: store.delivery_info || null,
    approval_status: store.approval_status,
    is_active: store.is_active,
    is_open: store.is_open,
    created_at: store.created_at,
    ...(extra || {})
  };
}

function formatTime12h(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm.trim();
  let h = Number(m[1]);
  const mins = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${mins} ${ampm}`;
}

function maskPhone(rawPhone?: string | null): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `${digits.slice(0, 2)}${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-2)}`;
}

function maskAddress(rawAddress?: string | null): string {
  const addr = String(rawAddress || '').trim();
  if (!addr) return '';
  if (addr.length <= 12) return `${addr.slice(0, 4)}****`;
  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    return `***, ${parts.slice(-2).join(', ')}`;
  }
  return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
}

app.post('/api/auth/register', authRegisterLimiter, async (req: Request, res: Response) => {
  try {
    const { phone, name, email, password, address, landmark, city, pincode, role } = req.body;

    if (role !== undefined && ['admin', 'super_admin', 'superadmin'].includes(String(role).trim().toLowerCase())) {
      return res.status(403).json({
        error: 'Forbidden: Admin accounts cannot be created through public registration.'
      });
    }

    const cleanPhone = normalizePhone(phone);
    const cleanPassword = typeof password === 'string' ? password.trim() : '';
    const cleanEmail = email ? String(email).trim() : '';
    const cleanPincode = pincode ? String(pincode).trim() : '';
    const cleanCity = city ? String(city).trim() : '';

    if (!cleanPhone || !name || !cleanPassword) {
      return res.status(400).json({ error: 'Phone number, name, and password are required.' });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (cleanPincode && !/^\d{6}$/.test(cleanPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit Indian PIN code.' });
    }

    // Public registration is strictly for customers only
    const userRole = 'customer';
    const existing = await usersRepo.findByPhoneAndRole(cleanPhone, userRole);
    if (existing) {
      return res.status(400).json({ error: `An account with this phone number already exists as ${userRole}. Please login.` });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    const user = await usersRepo.create({
      phone: cleanPhone,
      name: name.trim(),
      email: cleanEmail || null,
      role: userRole,
      password_hash: passwordHash,
      address: address ? address.trim() : null,
      landmark: landmark ? landmark.trim() : null,
      city: cleanCity,
      pincode: cleanPincode,
      is_active: true,
      created_at: new Date().toISOString()
    });

    const userPayload = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      email: user.email,
      role: user.role,
      status: 'active',
      is_active: true,
      address: user.address,
      landmark: user.landmark,
      city: user.city,
      pincode: user.pincode
    };

    const token = generateToken(userPayload as any);
    await logAudit(user.id, user.role, 'USER_REGISTERED', 'users', user.id, `User ${user.name} registered as ${user.role}`);

    setAuthCookie(req, res, token);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: userPayload
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: safeServerError(err, 'Registration failed. Please try again.') });
  }
});

app.post('/api/auth/login', authLoginLimiter, async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    const cleanPhone = normalizePhone(phone);
    const cleanPassword = typeof password === 'string' ? password.trim() : '';

    if (!cleanPhone || !cleanPassword) {
      return res.status(400).json({ error: 'Phone number and password are required.' });
    }

    const matchedUsers = await usersRepo.findByPhone(cleanPhone);

    if (matchedUsers.length === 0) {
      return res.status(401).json({ error: 'No account found with this mobile number.' });
    }

    // A phone number can belong to an admin or delivery rider (e.g. 9699925206)
    let matchedUser: UserDoc | null = null;
    for (const u of matchedUsers) {
      const isMatch = await bcrypt.compare(cleanPassword, u.password_hash);
      if (isMatch) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.' });
    }

    if (matchedUser.is_active === false) {
      return res.status(403).json({ error: 'Your account is deactivated. Please contact FMP Supermart platform support (9699925206).' });
    }

    const userPayload = {
      id: matchedUser.id,
      phone: matchedUser.phone,
      name: matchedUser.name,
      email: matchedUser.email,
      role: matchedUser.role,
      store_id: matchedUser.store_id ?? null,
      status: 'active',
      is_active: true,
      address: matchedUser.address,
      landmark: matchedUser.landmark,
      city: matchedUser.city || '',
      pincode: matchedUser.pincode || ''
    };

    const token = generateToken(userPayload as any);
    await logAudit(matchedUser.id, matchedUser.role, 'USER_LOGIN', 'users', matchedUser.id, `User ${matchedUser.name} logged in as ${matchedUser.role}`);

    setAuthCookie(req, res, token);

    res.json({
      token,
      user: userPayload
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ error: safeServerError(err, 'Login failed. Please try again.') });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  clearAuthCookie(req, res);
  res.json({ message: 'Logged out successfully.' });
});

// Secure Admin-Assisted Forgot Password Workflow
app.post('/api/auth/forgot-password-request', forgotPasswordLimiter, async (req: Request, res: Response) => {
  try {
    const { phone, notes } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Registered mobile number is required.' });
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit registered mobile number.' });
    }

    const matchedUsers = await usersRepo.findByPhone(cleanPhone);
    if (matchedUsers.length === 0) {
      return res.status(404).json({ error: 'No account found with this mobile number. Please check the number or register as a new customer.' });
    }

    const matched = matchedUsers[0];
    await passwordResetsRepo.create(cleanPhone, matched.name, matched.role, notes);

    await logAudit(
      matched.id,
      matched.role,
      'PASSWORD_RESET_REQUESTED',
      'password_reset_requests',
      matched.id,
      `User ${matched.name} requested password reset assistance`
    );

    res.json({
      message: 'Password reset request registered successfully! FMP Supermart platform support has received your ticket.',
      support_phone: '9699925206',
      support_address: 'FMP Supermart India Support Desk'
    });
  } catch (err: any) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: safeServerError(err, 'Failed to process password reset request.') });
  }
});

// Admin view pending password reset requests
app.get('/api/admin/password-reset-requests', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await passwordResetsRepo.listPending();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Admin reset password for a user
app.post('/api/admin/reset-user-password', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phone, new_password, request_id } = req.body;
    if (!phone || !new_password) {
      return res.status(400).json({ error: 'Phone number and new password are required.' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    const newHash = await bcrypt.hash(new_password, 10);

    const users = await usersRepo.findByPhone(cleanPhone);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const nowIso = new Date().toISOString();
    for (const u of users) {
      await usersRepo.update(u.id, { password_hash: newHash, password_changed_at: nowIso });
    }

    await passwordResetsRepo.resolve(cleanPhone, request_id ? parseInt(request_id, 10) : undefined);

    await logAudit(
      req.user!.id,
      'admin',
      'USER_PASSWORD_RESET',
      'users',
      users[0].id,
      `Admin reset password for user ${users[0].name} (${cleanPhone})`
    );

    res.json({ message: `Password reset successfully for ${users[0].name}.` });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

app.put('/api/auth/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (
      req.body.role !== undefined ||
      req.body.is_active !== undefined ||
      req.body.store_id !== undefined
    ) {
      return res.status(403).json({
        error: 'Forbidden: Account role, store ownership, and active status cannot be modified via profile editing.'
      });
    }

    const { name, address, landmark, email, city, pincode } = req.body;
    const cleanEmail = email !== undefined ? String(email).trim() : undefined;
    const cleanPincode = pincode !== undefined ? String(pincode).trim() : undefined;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (cleanPincode && !/^\d{6}$/.test(cleanPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit Indian PIN code.' });
    }

    const updatedUser = await usersRepo.update(req.user!.id, {
      ...(name ? { name: name.trim() } : {}),
      ...(address ? { address: address.trim() } : {}),
      ...(landmark !== undefined ? { landmark: landmark ? landmark.trim() : null } : {}),
      ...(cleanEmail !== undefined ? { email: cleanEmail || null } : {}),
      ...(city !== undefined ? { city: String(city).trim() } : {}),
      ...(cleanPincode !== undefined ? { pincode: cleanPincode } : {})
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const { password_hash: _pw, ...safeUser } = updatedUser;
    await logAudit(req.user!.id, req.user!.role, 'PROFILE_UPDATED', 'users', req.user!.id, `User updated profile information`);
    res.json({ message: 'Profile updated successfully', user: safeUser });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Customer Saved Delivery Addresses
// ----------------------------------------------------
app.get('/api/addresses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await addressesRepo.listByUser(req.user!.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/addresses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { label, recipient_name, phone, address, landmark, pincode, lat, lng, is_default } = req.body;
    const cleanAddress = String(address || '').trim();
    if (cleanAddress.length < 5) {
      return res.status(400).json({ error: 'Please enter a complete delivery address (at least 5 characters).' });
    }
    const cleanPhone = phone ? String(phone).trim().replace(/\D/g, '') : req.user!.phone;
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    const cleanPincode = pincode ? String(pincode).trim() : '';
    if (cleanPincode && !/^\d{6}$/.test(cleanPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit Indian PIN code.' });
    }
    const numLat = lat !== undefined && lat !== null ? Number(lat) : null;
    const numLng = lng !== undefined && lng !== null ? Number(lng) : null;
    const hasCoords = numLat !== null && numLng !== null && isValidCoordinate(numLat, numLng);

    const saved = await addressesRepo.create(req.user!.id, {
      label: String(label || 'Home').trim().slice(0, 40) || 'Home',
      recipient_name: String(recipient_name || req.user!.name).trim(),
      phone: cleanPhone,
      address: cleanAddress,
      landmark: landmark ? String(landmark).trim() : '',
      pincode: cleanPincode,
      lat: hasCoords ? numLat : null,
      lng: hasCoords ? numLng : null,
      is_default: Boolean(is_default)
    });
    res.status(201).json(saved);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/addresses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid address ID.' });
    }
    const result = await addressesRepo.remove(req.user!.id, id);
    if (result === 'not_found') return res.status(404).json({ error: 'Saved address not found.' });
    if (result === 'forbidden') return res.status(403).json({ error: 'Forbidden: You can only delete your own addresses.' });
    res.json({ message: 'Saved address deleted.' });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Categories & Products Routes
// ----------------------------------------------------
app.get('/api/categories', async (req: Request, res: Response) => {
  try {
    const list = await categoriesRepo.list();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Delivery Settings & Delivery Slots Endpoints
// Admin has complete control over delivery fee & handling
// ----------------------------------------------------
app.all(['/api/settings/delivery', '/api/admin/settings/delivery'], (req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Central warehouse delivery settings have been retired. Delivery fees and radius are managed per store.'
  });
});

// Public minimal platform status (NEVER exposes monetization flags)
app.get('/api/settings/platform', async (req: Request, res: Response) => {
  try {
    const settings = await settingsRepo.getPlatformSettings();
    res.json({
      platform_name: settings.platform_name,
      support_phone: settings.support_phone,
      support_email: settings.support_email,
      city: settings.city,
      service_available: settings.service_available,
      maintenance_message: settings.maintenance_message
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Admin-only full Platform Settings & Future Monetization Architecture controls
app.get('/api/admin/settings/platform', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const settings = await settingsRepo.getPlatformSettings();
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/admin/settings/platform', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      platform_name,
      support_phone,
      support_email,
      city,
      require_store_approval,
      store_visibility_rule,
      service_available,
      maintenance_message,
      monetization_enabled,
      subscriptions_enabled,
      featured_stores_enabled,
      store_ads_enabled,
      admob_enabled,
      adsense_enabled
    } = req.body;

    if (
      store_visibility_rule !== undefined &&
      !['approved_active_valid_location', 'approved_active_open_only'].includes(store_visibility_rule)
    ) {
      return res.status(400).json({ error: 'Invalid store visibility rule.' });
    }

    if (
      monetization_enabled === true ||
      subscriptions_enabled === true ||
      featured_stores_enabled === true ||
      store_ads_enabled === true ||
      admob_enabled === true ||
      adsense_enabled === true
    ) {
      return res.status(400).json({
        error: 'Monetization, subscriptions, featured store fees, and ad networks are permanently disabled on this platform.'
      });
    }

    const updated = await settingsRepo.updatePlatformSettings({
      ...(platform_name !== undefined && String(platform_name).trim()
        ? { platform_name: String(platform_name).trim().slice(0, 80) }
        : {}),
      ...(support_phone !== undefined ? { support_phone: String(support_phone).trim().slice(0, 20) } : {}),
      ...(support_email !== undefined ? { support_email: String(support_email).trim().slice(0, 120) } : {}),
      ...(city !== undefined && String(city).trim() ? { city: String(city).trim().slice(0, 120) } : {}),
      ...(require_store_approval !== undefined ? { require_store_approval: Boolean(require_store_approval) } : {}),
      ...(store_visibility_rule !== undefined ? { store_visibility_rule } : {}),
      ...(service_available !== undefined ? { service_available: Boolean(service_available) } : {}),
      ...(maintenance_message !== undefined
        ? { maintenance_message: String(maintenance_message).trim().slice(0, 300) }
        : {}),
      monetization_enabled: false,
      subscriptions_enabled: false,
      featured_stores_enabled: false,
      store_ads_enabled: false,
      admob_enabled: false,
      adsense_enabled: false
    });

    await logAudit(
      req.user!.id,
      'admin',
      'PLATFORM_SETTINGS_UPDATED',
      'settings',
      'platform_config',
      `Updated platform settings: service_available=${updated.service_available}, require_approval=${updated.require_store_approval}, visibility=${updated.store_visibility_rule}`
    );

    res.json({ message: 'Platform settings updated successfully.', settings: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/settings/delivery', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      default_delivery_fee,
      handling_fee,
      min_order_amount,
      delivery_areas,
      warehouse_lat,
      warehouse_lng,
      warehouse_address,
      delivery_pricing_mode,
      per_km_rate,
      free_delivery_up_to_km,
      max_delivery_distance_km,
      delivery_slabs
    } = req.body;

    const current = await settingsRepo.getDeliverySettings();

    const wLat = warehouse_lat !== undefined ? Number(warehouse_lat) : current.warehouse_lat;
    const wLng = warehouse_lng !== undefined ? Number(warehouse_lng) : current.warehouse_lng;
    if (!isValidCoordinate(wLat, wLng)) {
      return res.status(400).json({ error: 'Please provide valid central warehouse latitude and longitude coordinates.' });
    }

    const defFee = default_delivery_fee !== undefined ? Math.max(0, Number(default_delivery_fee)) : current.default_delivery_fee;
    const handFee = handling_fee !== undefined ? Math.max(0, Number(handling_fee)) : current.handling_fee;
    const minOrder = min_order_amount !== undefined ? Math.max(0, Number(min_order_amount)) : current.min_order_amount;
    const areasStr = delivery_areas !== undefined
      ? (typeof delivery_areas === 'object' ? JSON.stringify(delivery_areas) : String(delivery_areas))
      : current.delivery_areas;

    const pricingMode: 'slabs' | 'per_km' =
      delivery_pricing_mode === 'per_km'
        ? 'per_km'
        : delivery_pricing_mode === 'slabs'
        ? 'slabs'
        : current.delivery_pricing_mode;

    const perKmRate = per_km_rate !== undefined ? Math.max(0, Number(per_km_rate)) : current.per_km_rate;
    const freeUpToKm = free_delivery_up_to_km !== undefined ? Math.max(0, Number(free_delivery_up_to_km)) : current.free_delivery_up_to_km;
    const maxDistKm = max_delivery_distance_km !== undefined ? Number(max_delivery_distance_km) : current.max_delivery_distance_km;
    if (!Number.isFinite(maxDistKm) || maxDistKm <= 0) {
      return res.status(400).json({ error: 'Maximum delivery distance must be greater than 0 km.' });
    }

    let slabs = current.delivery_slabs;
    if (Array.isArray(delivery_slabs)) {
      for (const s of delivery_slabs) {
        const minK = Number(s.min_km);
        const maxK = Number(s.max_km);
        const chg = Number(s.charge);
        if (!Number.isFinite(minK) || minK < 0 || !Number.isFinite(maxK) || maxK <= minK) {
          return res.status(400).json({ error: 'Each delivery slab must have valid distances where max km > min km.' });
        }
        if (!Number.isFinite(chg) || chg < 0) {
          return res.status(400).json({ error: 'Delivery slab charge cannot be negative.' });
        }
      }
      slabs = normalizeDeliverySlabs(delivery_slabs);
    }

    const updated = await settingsRepo.updateDeliverySettings({
      default_delivery_fee: defFee,
      handling_fee: handFee,
      min_order_amount: minOrder,
      delivery_areas: areasStr,
      warehouse_lat: wLat,
      warehouse_lng: wLng,
      warehouse_address: warehouse_address !== undefined ? String(warehouse_address).trim() : current.warehouse_address,
      delivery_pricing_mode: pricingMode,
      per_km_rate: perKmRate,
      free_delivery_up_to_km: freeUpToKm,
      max_delivery_distance_km: maxDistKm,
      delivery_slabs: slabs
    });

    await logAudit(
      req.user!.id,
      'admin',
      'DELIVERY_SETTINGS_UPDATED',
      'delivery_settings',
      1,
      `Updated warehouse (${wLat.toFixed(4)}, ${wLng.toFixed(4)}), mode=${pricingMode}, max=${maxDistKm}km, handling=₹${handFee}`
    );
    res.json({ message: 'Delivery & distance settings updated successfully.', settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/delivery/calculate-fee', (req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Central warehouse delivery fee calculation is retired. Use /api/stores/:id/delivery-quote instead.'
  });
});

// OpenStreetMap Nominatim + Photon location search (supports local landmarks, chowks, roads & nearby areas)
app.get('/api/locations/search', locationLookupLimiter, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ query: q, results: [] });
    }

    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const refLat = isValidCoordinate(qLat, qLng) ? qLat : undefined;
    const refLng = isValidCoordinate(qLat, qLng) ? qLng : undefined;

    const results = await searchOsmLocations(q, refLat, refLng);
    res.json({ query: q, results });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Unable to search OpenStreetMap areas right now.' });
  }
});

// OpenStreetMap reverse-geocoding endpoint for map pins, GPS, and selected search coordinates
app.get('/api/locations/reverse', locationLookupLimiter, async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!isValidCoordinate(lat, lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required for reverse geocoding.' });
    }
    const result = await reverseGeocodeOsm(lat, lng);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Unable to reverse-geocode location.' });
  }
});

// Retired central warehouse delivery slots (stores manage delivery & pickup directly)
app.all(['/api/delivery-slots', '/api/admin/delivery-slots', '/api/admin/delivery-slots/:id'], (req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Central delivery slots have been retired. Orders use store-managed delivery or store pickup.'
  });
});

// Public Customer Catalog (ALWAYS strips wholesale purchase cost, margins, and supplier details)
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category, search, in_stock } = req.query;
    const products = await productsRepo.list({
      category: category as string,
      search: search as string,
      in_stock: in_stock === 'true',
      includeWholesale: false
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const product = await productsRepo.findById(id);
    if (!product || product.is_deleted || product.is_active === false || !product.store_id || product.store_id <= 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    const store = await storesRepo.findById(product.store_id);
    if (!store || store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(sanitizeProductForCustomer(product));
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Admin Store Product Catalog Overview (Hyperlocal stores only, no central warehouse/wholesale)
app.get('/api/admin/products', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, search, in_stock } = req.query;
    const products = await productsRepo.list({
      category: category as string,
      search: search as string,
      in_stock: in_stock === 'true',
      includeInactive: true,
      includeWholesale: false
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Admin Product Moderation: Enable / Disable or Delete Store Products
app.put('/api/admin/products/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid product ID.' });
    }
    const { is_active, reason } = req.body || {};
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active boolean is required.' });
    }

    const existing = await productsRepo.findById(id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    if (is_active === true && Number(existing.stock) <= 0) {
      return res.status(400).json({ error: 'Cannot enable a product with 0 stock. Ask the store owner to restock first.' });
    }

    const updated = await productsRepo.update(id, { is_active });
    if (existing.store_id) {
      const store = await storesRepo.findById(existing.store_id);
      if (store?.owner_id) {
        await notificationsRepo.create({
          user_id: store.owner_id,
          title: is_active ? 'Product Enabled by Admin' : 'Product Disabled by Admin',
          message: `Admin ${is_active ? 'enabled' : 'disabled'} "${existing.name}" in ${store.name}.${reason ? ` Note: ${String(reason).trim()}` : ''}`,
          type: 'store'
        });
      }
    }

    await logAudit(
      req.user!.id,
      'admin',
      'ADMIN_PRODUCT_STATUS_UPDATED',
      'products',
      id,
      `Admin set product "${existing.name}" (#${id}) is_active=${is_active}${reason ? ` (${String(reason).trim()})` : ''}`
    );

    res.json(sanitizeProductForCustomer(updated!));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update product status.' });
  }
});

app.delete('/api/admin/products/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid product ID.' });
    }

    const existing = await productsRepo.findById(id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const referencedInOrders = await productsRepo.isProductReferencedInOrders(id);
    await productsRepo.softDelete(id);

    if (existing.store_id) {
      const store = await storesRepo.findById(existing.store_id);
      if (store?.owner_id) {
        await notificationsRepo.create({
          user_id: store.owner_id,
          title: 'Product Removed by Admin',
          message: `Admin removed "${existing.name}" from ${store.name} catalog.`,
          type: 'store'
        });
      }
    }

    await logAudit(
      req.user!.id,
      'admin',
      'ADMIN_PRODUCT_DELETED',
      'products',
      id,
      `Admin removed product "${existing.name}" (#${id})`
    );

    res.json({
      message: referencedInOrders
        ? 'Product is linked to existing orders and has been safely deactivated while preserving order history.'
        : 'Product deleted successfully by Admin.',
      referenced_in_orders: referencedInOrders
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Backend authoritative quantity-slab cart pricing & stock/quantity validation
app.post('/api/pricing/calculate-cart', async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.json({
        all_valid: true,
        errors: [],
        items: [],
        subtotal: 0,
        regular_subtotal: 0,
        total_savings: 0
      });
    }

    const resolvedItems = [];
    const errors: string[] = [];
    let subtotal = 0;
    let regularSubtotal = 0;
    let totalSavings = 0;
    let cartStoreId: number | null | undefined = undefined;
    let storeMixedErrorAdded = false;
    const checkedStores = new Map<number, StoreDoc | null>();

    for (const it of items) {
      const productId = Number(it?.product_id);
      const quantity = Number(it?.quantity);
      const product = Number.isFinite(productId) ? await productsRepo.findById(productId) : null;

      if (!product || product.is_deleted || product.is_active === false) {
        const msg = product
          ? `"${product.name}" is currently unavailable.`
          : `Product #${it?.product_id} is no longer available.`;
        errors.push(msg);
        resolvedItems.push({
          valid: false,
          error: msg,
          product_id: productId || 0,
          product_name: product?.name || 'Unavailable item',
          product_type: 'packaged',
          unit: product?.unit || '1 unit',
          quantity: Number.isFinite(quantity) ? quantity : 0,
          stock: 0,
          regular_unit_price: 0,
          applied_unit_price: 0,
          regular_total: 0,
          line_total: 0,
          savings: 0,
          savings_percent: 0,
          applied_slab: null,
          applied_slab_label: null,
          next_slab_hint: null
        });
        continue;
      }

      const itemStoreId = product.store_id ? Number(product.store_id) : 0;
      if (!itemStoreId || itemStoreId <= 0) {
        errors.push(`"${product.name}" is not linked to an active local store.`);
      } else {
        if (cartStoreId === undefined) {
          cartStoreId = itemStoreId;
        } else if (cartStoreId !== itemStoreId && !storeMixedErrorAdded) {
          errors.push('Cart items cannot mix products from different stores.');
          storeMixedErrorAdded = true;
        }

        if (!checkedStores.has(itemStoreId)) {
          checkedStores.set(itemStoreId, await storesRepo.findById(itemStoreId));
        }
        const st = checkedStores.get(itemStoreId);
        if (!st || st.approval_status !== 'approved' || st.is_active === false) {
          errors.push(`Store for "${product.name}" is currently unavailable.`);
        } else if (st.is_open === false) {
          errors.push(`${st.name} is currently closed and not accepting orders.`);
        }
      }

      const resolved = resolveProductQuantityPricing(product, quantity);
      if (!resolved.valid && resolved.error) {
        errors.push(resolved.error);
      }
      subtotal = Math.round((subtotal + resolved.line_total) * 100) / 100;
      regularSubtotal = Math.round((regularSubtotal + resolved.regular_total) * 100) / 100;
      totalSavings = Math.round((totalSavings + resolved.savings) * 100) / 100;
      resolvedItems.push(resolved);
    }

    res.json({
      all_valid: errors.length === 0,
      errors,
      items: resolvedItems,
      subtotal,
      regular_subtotal: regularSubtotal,
      total_savings: totalSavings
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Retired central warehouse product mutations (store owners manage their own store catalogs)
app.all(['/api/products', '/api/products/:id', '/api/products/:id/stock'], requireAuth, (req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Central product management is retired. Store owners manage products directly under /api/store-owner/products.'
  });
});

// ----------------------------------------------------
// Order Management (Business Rules & Transactions)
// ----------------------------------------------------
app.post('/api/orders', orderCreateLimiter, requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      items,
      store_id,
      fulfillment_type,
      payment_mode,
      idempotency_key,
      customer_name,
      customer_phone,
      delivery_address,
      landmark,
      pincode,
      tip_amount,
      delivery_type,
      scheduled_date,
      time_slot,
      customer_lat,
      customer_lng
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Please add items to checkout.' });
    }

    const platformSettings = await settingsRepo.getPlatformSettings();
    if (platformSettings.service_available === false) {
      return res.status(503).json({
        error:
          platformSettings.maintenance_message ||
          'Platform ordering is temporarily paused by administrator. Please try again shortly.'
      });
    }

    if (payment_mode !== undefined && !['COD', 'Pay at Store'].includes(payment_mode)) {
      return res.status(400).json({ error: 'Only Cash on Delivery (COD) and Pay at Store are supported.' });
    }

    const cleanPhone = String(customer_phone || req.user!.phone || '').trim().replace(/\D/g, '');
    const recipientName = String(customer_name || req.user!.name || '').trim();
    const storeId = store_id ? Number(store_id) : 0;
    const fulfillment: 'delivery' | 'pickup' = fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
    const resolvedPaymentMode: 'COD' | 'Pay at Store' =
      fulfillment === 'pickup' ? 'Pay at Store' : 'COD';

    if (!storeId || storeId <= 0) {
      return res.status(400).json({ error: 'Please select an approved local grocery store to place your order.' });
    }

    const storeDoc = await storesRepo.findById(storeId);
    if (!storeDoc) {
      return res.status(404).json({ error: 'Selected grocery store was not found.' });
    }
    if (storeDoc.approval_status !== 'approved' || storeDoc.is_active === false) {
      return res.status(400).json({ error: 'This store is not currently active on FMP Supermart.' });
    }
    if (storeDoc.is_open === false) {
      return res.status(400).json({ error: `${storeDoc.name} is currently closed and not accepting orders.` });
    }
    const supportsDelivery = storeDoc.service_type === 'delivery' || storeDoc.service_type === 'both';
    const supportsPickup = storeDoc.service_type === 'pickup' || storeDoc.service_type === 'both';
    if (fulfillment === 'delivery' && !supportsDelivery) {
      return res.status(400).json({ error: `${storeDoc.name} only offers Store Pickup.` });
    }
    if (fulfillment === 'pickup' && !supportsPickup) {
      return res.status(400).json({ error: `${storeDoc.name} only offers Home Delivery.` });
    }

    const address =
      fulfillment === 'pickup'
        ? `Store Pickup: ${storeDoc.name}, ${storeDoc.address}`
        : String(delivery_address || req.user!.address || '').trim();

    if (!recipientName || cleanPhone.length < 10 || !address || (fulfillment === 'delivery' && address.length < 5)) {
      return res.status(400).json({ error: 'Recipient name, valid 10-digit mobile number, and complete delivery address are mandatory.' });
    }

    let cLat = Number(customer_lat);
    let cLng = Number(customer_lng);
    let road: { distance_km: number; duration_mins: number | null; source: 'osrm' | 'haversine_fallback' };
    let pickupCode: string | null = null;

    if (fulfillment === 'pickup') {
      if (!isValidCoordinate(cLat, cLng)) {
        cLat = storeDoc.lat;
        cLng = storeDoc.lng;
      }
      road = { distance_km: 0, duration_mins: null, source: 'osrm' };
      pickupCode = generatePickupCode();
    } else {
      if (!isValidCoordinate(cLat, cLng)) {
        return res.status(400).json({ error: 'Please pin your delivery location on the map to calculate delivery distance and charges.' });
      }
      road = await calculateRoadDistanceKm(storeDoc.lat, storeDoc.lng, cLat, cLng);
      if (storeDoc.delivery_radius_km > 0 && road.distance_km > storeDoc.delivery_radius_km) {
        return res.status(400).json({
          error: `Delivery unavailable beyond ${storeDoc.delivery_radius_km} km for ${storeDoc.name}. Your location is ${road.distance_km} km away.`
        });
      }
    }

    // Short-window identical fingerprint duplicate guard (in addition to atomic Firestore idempotency_key lock)
    const requestSig = items
      .map((i: any) => `${Number(i.product_id)}:${Number(i.quantity)}`)
      .sort()
      .join('|');
    const recentOrders = await ordersRepo.list({ customer_id: req.user!.id });
    const itemsMapForDup = recentOrders.length > 0 ? await ordersRepo.listItemsMap() : new Map();
    const now = Date.now();
    const isDuplicate = recentOrders.some(o => {
      const orderAgeMs = now - new Date(o.created_at).getTime();
      if (orderAgeMs < 0 || orderAgeMs >= 5000) return false;
      if (o.delivery_address !== address || (o.store_id ?? null) !== storeId || (o.fulfillment_type || 'delivery') !== fulfillment) {
        return false;
      }
      const existingSig = (itemsMapForDup.get(o.id) || [])
        .map((it: any) => `${Number(it.product_id)}:${Number(it.quantity)}`)
        .sort()
        .join('|');
      return existingSig === requestSig;
    });
    if (isDuplicate) {
      return res.status(409).json({ error: 'Duplicate order detected. You have already placed this order a moment ago.', duplicate: true });
    }

    const adminUsers = await usersRepo.listAdmins();

    const created = await ordersRepo.createTransactional(
      {
        customerId: req.user!.id,
        customerName: recipientName,
        customerPhone: cleanPhone,
        storeId: storeDoc.id,
        fulfillmentType: fulfillment,
        paymentMode: resolvedPaymentMode,
        idempotencyKey: idempotency_key ? String(idempotency_key) : null,
        pickupCode,
        address,
        landmark: landmark || storeDoc.landmark || storeDoc.city || '',
        pincode: pincode || storeDoc.pincode || '',
        deliveryType: delivery_type === 'scheduled' ? 'scheduled' : 'immediate',
        scheduledDate: scheduled_date || (delivery_type === 'scheduled' ? 'Today' : 'Immediate Express'),
        timeSlot: time_slot || (fulfillment === 'pickup' ? 'Store Pickup' : delivery_type === 'scheduled' ? '09:00 AM - 12:00 PM' : 'Within 45-60 mins'),
        tipAmount: 0,
        customerLat: cLat,
        customerLng: cLng,
        distanceKm: road.distance_km,
        durationMins: road.duration_mins,
        distanceSource: road.source
      },
      items,
      adminUsers
    );

    await logAudit(
      req.user!.id,
      req.user!.role,
      'ORDER_PLACED',
      'orders',
      created.order.id,
      `Order ${created.order.order_number} placed for ₹${created.order.total_amount} (${fulfillment}, ${created.order.distance_km} km, delivery ₹${created.order.delivery_fee})`
    );

    res.status(201).json({
      message: 'Order placed successfully!',
      order: {
        ...created.order,
        store_address: storeDoc?.address || null,
        store_delivery_info: storeDoc?.delivery_info || null,
        items: created.items
      }
    });
  } catch (err: any) {
    const msg = String(err?.message || 'Failed to place order.');
    if (msg.startsWith('DUPLICATE_ORDER:')) {
      const parts = msg.split(':');
      return res.status(409).json({
        error: parts.slice(2).join(':') || 'Duplicate order prevented. This order has already been submitted.',
        duplicate: true,
        existing_order_id: parts[1] ? Number(parts[1]) : undefined
      });
    }
    console.error('Order placement error:', err);
    res.status(400).json({ error: msg });
  }
});

// Get orders list (Role-filtered, PII-masked for Admin, pickup_code hidden from Store Owner & Admin)
app.get('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role === 'rider') {
      return res.status(410).json({ error: 'Platform delivery rider accounts have been retired.' });
    }

    let orders: OrderDoc[] = [];
    if (req.user!.role === 'customer') {
      orders = await ordersRepo.list({ customer_id: req.user!.id });
    } else if (req.user!.role === 'store_owner') {
      const myStore = await storesRepo.findByOwnerId(req.user!.id);
      orders = myStore ? await ordersRepo.list({ store_id: myStore.id }) : [];
    } else {
      orders = await ordersRepo.list();
    }

    const [itemsMap, storesList] = await Promise.all([
      orders.length > 0 ? ordersRepo.listItemsMap() : Promise.resolve(new Map()),
      orders.some(o => o.store_id) ? storesRepo.listAll() : Promise.resolve([])
    ]);
    const storeMap = new Map(storesList.map(s => [s.id, s]));

    const sanitized = orders.map(o => {
      const isCustomerOwner = req.user!.role === 'customer' && o.customer_id === req.user!.id;
      const isAdmin = req.user!.role === 'admin';
      const st = o.store_id ? storeMap.get(o.store_id) : null;
      return {
        ...o,
        customer_phone: isAdmin ? maskPhone(o.customer_phone) : o.customer_phone,
        delivery_address: isAdmin ? maskAddress(o.delivery_address) : o.delivery_address,
        store_address: st?.address || null,
        store_delivery_info: st?.delivery_info || null,
        delivery_otp: undefined,
        pickup_code: isCustomerOwner && o.fulfillment_type === 'pickup' ? o.pickup_code : undefined,
        items: itemsMap.get(o.id) || []
      };
    });

    res.json(sanitized);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Single order details with items
app.get('/api/orders/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role === 'rider') {
      return res.status(410).json({ error: 'Platform delivery rider accounts have been retired.' });
    }

    const id = parseInt(req.params.id, 10);
    const { order, items } = await ordersRepo.findById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (req.user!.role === 'store_owner') {
      const myStore = await storesRepo.findByOwnerId(req.user!.id);
      if (!myStore || order.store_id !== myStore.id) {
        return res.status(403).json({ error: 'Access denied.' });
      }
    }

    const st = order.store_id ? await storesRepo.findById(order.store_id) : null;
    const isCustomerOwner = req.user!.role === 'customer' && order.customer_id === req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    res.json({
      ...order,
      customer_phone: isAdmin ? maskPhone(order.customer_phone) : order.customer_phone,
      delivery_address: isAdmin ? maskAddress(order.delivery_address) : order.delivery_address,
      store_address: st?.address || null,
      store_delivery_info: st?.delivery_info || null,
      delivery_otp: undefined,
      pickup_code: isCustomerOwner && order.fulfillment_type === 'pickup' ? order.pickup_code : undefined,
      items
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Cancel Order & Restore Stock
app.post('/api/orders/:id/cancel', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;

    if (req.user!.role === 'rider') {
      return res.status(403).json({ error: 'Delivery partners cannot cancel customer orders.' });
    }

    const { order } = await ordersRepo.findById(id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'You cannot cancel another customer’s order.' });
    }
    if (req.user!.role === 'store_owner') {
      const myStore = await storesRepo.findByOwnerId(req.user!.id);
      if (!myStore || order.store_id !== myStore.id) {
        return res.status(403).json({ error: 'You cannot cancel an order belonging to another store.' });
      }
    }

    const adminUsers = await usersRepo.listAdmins();
    const cancelledOrder = await ordersRepo.cancelOrderTransactional(
      id,
      reason,
      { id: req.user!.id, name: req.user!.name, role: req.user!.role },
      adminUsers
    );

    await logAudit(req.user!.id, req.user!.role, 'ORDER_CANCELLED', 'orders', id, `Cancelled order #${cancelledOrder.order_number}`);
    res.json({ message: 'Order cancelled and stock restored successfully.', order: cancelledOrder });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Retired central warehouse order lifecycle & platform rider fleet management routes
app.all(
  [
    '/api/orders/:id/status',
    '/api/orders/:id/assign-rider',
    '/api/orders/:id/delivery-fee',
    '/api/orders/:id/dispatch',
    '/api/admin/riders',
    '/api/admin/riders/:id',
    '/api/admin/riders/:id/reset-password'
  ],
  requireAuth,
  (req: Request, res: Response) => {
    return res.status(410).json({
      error: 'Platform rider fleet and central order fulfillment have been retired. Store owners manage order fulfillment directly.'
    });
  }
);

// Admin Dashboard Analytics & Statistics
app.get('/api/admin/stats', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [orders, allProducts, stores, customers, complaints] = await Promise.all([
      ordersRepo.list(),
      productsRepo.list({ includeInactive: true, includeWholesale: false }),
      storesRepo.listAll(),
      usersRepo.listCustomers(),
      complaintsRepo.listAll()
    ]);

    const placedCount = orders.filter(o => o.status === 'placed').length;
    const confirmedCount = orders.filter(o => o.status === 'confirmed').length;
    const packedCount = orders.filter(o => o.status === 'packed').length;
    const dispatchedCount = orders.filter(o => o.status === 'dispatched').length;
    const deliveredCount = orders.filter(o => o.status === 'delivered').length;
    const cancelledCount = orders.filter(o => o.status === 'cancelled').length;

    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    const totalRevenue = deliveredOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);

    const activeProducts = allProducts.filter(p => p.is_active !== false && !p.is_deleted);
    const outOfStock = activeProducts.filter(p => p.stock === 0).length;
    const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= 10).length;
    const totalUnits = activeProducts.reduce((sum, p) => sum + Number(p.stock), 0);

    const lowStockItems = activeProducts
      .filter(p => p.stock <= 10)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10);

    const recentOrders = orders.slice(0, 8).map(o => ({
      ...o,
      customer_phone: maskPhone(o.customer_phone),
      delivery_address: maskAddress(o.delivery_address),
      delivery_otp: undefined,
      pickup_code: undefined
    }));

    const approvedStores = stores.filter(s => s.approval_status === 'approved').length;
    const pendingStores = stores.filter(s => s.approval_status === 'pending').length;
    const rejectedStores = stores.filter(s => s.approval_status === 'rejected').length;
    const suspendedStores = stores.filter(s => s.approval_status === 'approved' && s.is_active === false).length;
    const pendingOrdersCount = placedCount + confirmedCount + packedCount;
    const openComplaintsCount = complaints.filter(c => c.status === 'open' || c.status === 'in_review').length;

    res.json({
      orders: {
        total_orders: orders.length,
        placed_count: placedCount,
        confirmed_count: confirmedCount,
        packed_count: packedCount,
        dispatched_count: dispatchedCount,
        delivered_count: deliveredCount,
        cancelled_count: cancelledCount,
        total_revenue: totalRevenue,
        today_revenue: totalRevenue,
        unreconciled_cash: 0
      },
      inventory: {
        total_products: activeProducts.length,
        out_of_stock: outOfStock,
        low_stock: lowStock,
        total_units_in_stock: totalUnits
      },
      platform: {
        total_customers: customers.length,
        total_stores: stores.length,
        approved_stores: approvedStores,
        pending_stores: pendingStores,
        rejected_stores: rejectedStores,
        suspended_stores: suspendedStores,
        total_products: allProducts.length,
        active_products: activeProducts.length,
        total_orders: orders.length,
        pending_orders: pendingOrdersCount,
        dispatched_orders: dispatchedCount,
        completed_orders: deliveredCount,
        cancelled_orders: cancelledCount,
        total_complaints: complaints.length,
        open_complaints: openComplaintsCount
      },
      lowStockItems,
      recentOrders
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Admin Reports (Sales, Category Volume, Daily Trend)
app.get('/api/admin/reports', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = await ordersRepo.list();
    const deliveredOrders = orders.filter(o => o.status === 'delivered');

    // Aggregate category sales from delivered orders
    const itemsSnap = await getDocs(collection(firestoreDb, 'order_items'));
    const allItems = itemsSnap.docs.map(d => d.data());
    const deliveredOrderIds = new Set(deliveredOrders.map(o => o.id));
    const deliveredItems = allItems.filter(i => deliveredOrderIds.has(i.order_id));

    const products = await productsRepo.list({ includeInactive: true, includeWholesale: false });
    const prodMap = new Map(products.map(p => [p.id, p]));

    const catSalesMap: Record<string, { units: number; revenue: number }> = {};
    for (const it of deliveredItems) {
      const prod = prodMap.get(it.product_id);
      const catName = prod?.category_name || 'Grocery';
      if (!catSalesMap[catName]) catSalesMap[catName] = { units: 0, revenue: 0 };
      catSalesMap[catName].units += Number(it.quantity) || 1;
      catSalesMap[catName].revenue += Number(it.total) || 0;
    }

    const categorySales = Object.entries(catSalesMap)
      .map(([category, d]) => ({ category, units_sold: d.units, revenue: d.revenue }))
      .sort((a, b) => b.revenue - a.revenue);

    const invSnap = await getDocs(collection(firestoreDb, 'inventory'));
    const inventoryLogs = invSnap.docs
      .map(d => d.data())
      .filter((log: any) => prodMap.has(Number(log.product_id)))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 25);

    res.json({
      categorySales,
      inventoryLogs
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Audit Logs
app.get('/api/admin/audit-logs', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requestedLimit = Number(req.query.limit) || 100;
    const safeLimit = Math.min(200, Math.max(10, requestedLimit));
    const logs = await auditLogsRepo.list(safeLimit);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// Retired central suppliers, purchase orders, rider fleet, and COD reconciliation routes
app.all(
  [
    '/api/suppliers',
    '/api/purchase-orders',
    '/api/purchase-orders/:id/receive',
    '/api/rider/assigned-orders',
    '/api/rider/orders/:id/verify-otp-deliver',
    '/api/rider/orders/:id/report-failed',
    '/api/rider/cod-summary',
    '/api/admin/cod-pending',
    '/api/admin/cod-reconcile'
  ],
  requireAuth,
  (req: Request, res: Response) => {
    return res.status(410).json({
      error: 'Legacy central warehouse procurement and rider COD reconciliation routes have been retired.'
    });
  }
);

// Notifications
app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await notificationsRepo.listForUser(req.user!.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await notificationsRepo.markRead(id, req.user!.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/notifications/mark-all-read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await notificationsRepo.markAllRead(req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Favorites (Wishlist & Quick-Add)
// ----------------------------------------------------
app.get('/api/favorites', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const favs = await favoritesRepo.listForCustomer(req.user!.id);
    res.json(favs);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/favorites/:productId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    const isAdded = await favoritesRepo.toggle(req.user!.id, productId);
    res.json({
      is_favorite: isAdded,
      message: isAdded ? 'Added to favorites' : 'Removed from favorites'
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Product Reviews & Ratings (1-5 Stars + Verified Purchase Check)
// ----------------------------------------------------
app.get('/api/products/:productId/reviews', async (req: Request, res: Response) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    const result = await reviewsRepo.listForProduct(productId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/products/:productId/reviews', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    const { rating, review_text } = req.body;

    const numRating = parseInt(rating, 10);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ error: 'Please give a star rating between 1 and 5.' });
    }

    if (!review_text || !review_text.trim()) {
      return res.status(400).json({ error: 'Please write a brief review of the product.' });
    }

    // Verified purchase check
    const customerOrders = await ordersRepo.list({ customer_id: req.user!.id });
    const deliveredOrders = customerOrders.filter(o => o.status === 'delivered');

    let isVerifiedPurchase = false;
    let verifiedOrderId: number | null = null;

    if (deliveredOrders.length > 0) {
      const itemsSnap = await getDocs(collection(firestoreDb, 'order_items'));
      const allItems = itemsSnap.docs.map(d => d.data());
      const deliveredIds = new Set(deliveredOrders.map(o => o.id));
      const match = allItems.find(i => deliveredIds.has(i.order_id) && i.product_id === productId);
      if (match) {
        isVerifiedPurchase = true;
        verifiedOrderId = match.order_id;
      }
    }

    const review = await reviewsRepo.create({
      product_id: productId,
      customer_id: req.user!.id,
      customer_name: req.user!.name,
      order_id: verifiedOrderId,
      rating: numRating,
      review_text: review_text.trim(),
      status: 'approved'
    });

    await logAudit(
      req.user!.id,
      req.user!.role,
      'PRODUCT_REVIEW_ADDED',
      'reviews',
      review.id,
      `User ${req.user!.name} rated product ${productId} ${numRating} stars`
    );

    res.status(201).json({
      message: 'Thank you for your rating & review!',
      review
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/admin/reviews', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await reviewsRepo.listAll();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/admin/reviews/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected.' });
    }

    const updated = await reviewsRepo.updateStatus(id, status);
    if (!updated) return res.status(404).json({ error: 'Review not found.' });

    await logAudit(req.user!.id, 'admin', 'REVIEW_MODERATED', 'reviews', id, `Review status changed to ${status}`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await reviewsRepo.deleteReview(id);
    await logAudit(req.user!.id, 'admin', 'REVIEW_DELETED', 'reviews', id, 'Deleted review');
    res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Hyperlocal Grocery Marketplace: Store Self-Registration & Public Discovery
// ----------------------------------------------------
app.post('/api/stores/register', storeRegisterLimiter, async (req: Request, res: Response) => {
  try {
    const {
      owner_name,
      phone,
      email,
      password,
      store_name,
      description,
      address,
      landmark,
      city,
      district,
      state,
      pincode,
      lat,
      lng,
      photos,
      opening_hours,
      service_type,
      delivery_radius_km,
      delivery_fee,
      min_order_amount
    } = req.body;

    const cleanPhone = normalizePhone(phone);
    const cleanPassword = typeof password === 'string' ? password.trim() : '';
    const cleanEmail = email ? String(email).trim() : '';
    const cleanCity = city ? String(city).trim() : '';
    const cleanDistrict = district ? String(district).trim() : '';
    const cleanState = state ? String(state).trim() : '';
    const cleanPincode = pincode ? String(pincode).trim() : '';

    if (!owner_name?.trim() || !cleanPhone || !cleanPassword || !store_name?.trim() || !address?.trim()) {
      return res.status(400).json({
        error: 'Owner name, 10-digit mobile number, password, store name, and store address are required.'
      });
    }
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid store email address.' });
    }
    if (cleanPincode && !/^\d{6}$/.test(cleanPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit Indian PIN code.' });
    }

    const sLat = Number(lat);
    const sLng = Number(lng);
    if (!isValidCoordinate(sLat, sLng)) {
      return res.status(400).json({ error: 'Please pin your exact store location on the map.' });
    }

    const existingOwner = await usersRepo.findByPhoneAndRole(cleanPhone, 'store_owner');
    if (existingOwner) {
      return res.status(400).json({
        error: 'A store owner account with this mobile number already exists. Please sign in instead.'
      });
    }

    const validServiceType: 'delivery' | 'pickup' | 'both' =
      service_type === 'delivery' || service_type === 'pickup' || service_type === 'both'
        ? service_type
        : 'both';

    const cleanPhotos = sanitizeStorePhotos(photos);
    const passwordHash = await bcrypt.hash(cleanPassword, 10);
    const nowIso = new Date().toISOString();

    const ownerUser = await usersRepo.create({
      phone: cleanPhone,
      name: owner_name.trim(),
      email: cleanEmail || null,
      role: 'store_owner',
      store_id: null,
      password_hash: passwordHash,
      address: address.trim(),
      landmark: landmark?.trim() || null,
      city: cleanCity,
      pincode: cleanPincode,
      is_active: true,
      created_at: nowIso
    });

    const store = await storesRepo.create({
      owner_id: ownerUser.id,
      owner_name: owner_name.trim(),
      owner_phone: cleanPhone,
      email: cleanEmail || null,
      name: store_name.trim(),
      description: description?.trim() || null,
      address: address.trim(),
      landmark: landmark?.trim() || null,
      city: cleanCity,
      district: cleanDistrict || null,
      state: cleanState || null,
      pincode: cleanPincode,
      lat: sLat,
      lng: sLng,
      logo_url: null,
      banner_url: null,
      photos: cleanPhotos,
      opening_hours: opening_hours?.trim() || '08:00 AM - 09:00 PM',
      opening_time: null,
      closing_time: null,
      weekly_closed_days: [],
      service_type: validServiceType,
      delivery_radius_km: Math.max(0.5, Number(delivery_radius_km) || 5),
      delivery_fee: Math.max(0, Number(delivery_fee) || 0),
      min_order_amount: Math.max(0, Number(min_order_amount) || 0),
      delivery_info: null,
      approval_status: 'pending',
      rejection_reason: null,
      is_active: true,
      is_open: true,
      featured: false,
      subscription_tier: 'free',
      created_at: nowIso,
      updated_at: nowIso
    });

    await usersRepo.update(ownerUser.id, { store_id: store.id });

    const adminUsers = await usersRepo.listAdmins();
    for (const adm of adminUsers) {
      await notificationsRepo.create({
        user_id: adm.id,
        title: 'New Store Registration Pending Approval 🏪',
        message: `${store.name}${cleanCity ? ` (${cleanCity})` : ''} (${owner_name.trim()}, ${cleanPhone}) has registered and awaits your approval.`,
        type: 'store'
      });
    }

    const userPayload = {
      id: ownerUser.id,
      phone: ownerUser.phone,
      name: ownerUser.name,
      email: ownerUser.email,
      role: ownerUser.role,
      store_id: store.id,
      is_active: true,
      address: ownerUser.address,
      landmark: ownerUser.landmark,
      city: ownerUser.city,
      pincode: ownerUser.pincode
    };

    const token = generateToken(userPayload as any);
    await logAudit(ownerUser.id, 'store_owner', 'STORE_REGISTERED', 'stores', store.id, `Registered store ${store.name} (pending admin approval)`);

    setAuthCookie(req, res, token);

    res.status(201).json({
      message: 'Store registered successfully! Your store is pending Admin approval before appearing to customers.',
      token,
      user: userPayload,
      store: sanitizePublicStore(store)
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Store registration failed.' });
  }
});

// Customer Store Discovery: Returns real Admin-approved active stores across India, sorted by distance when coordinates are supplied
app.get('/api/stores/nearby', async (req: Request, res: Response) => {
  try {
    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const hasCoords = isValidCoordinate(qLat, qLng);
    const search = String(req.query.search || '').trim().toLowerCase();
    const cityFilter = String(req.query.city || '').trim().toLowerCase();
    const stateFilter = String(req.query.state || '').trim().toLowerCase();
    const districtFilter = String(req.query.district || '').trim().toLowerCase();
    const pincodeFilter = String(req.query.pincode || '').trim();

    const platformSettings = await settingsRepo.getPlatformSettings();
    const approvedStores = (await storesRepo.listApprovedActive()).filter(st => {
      if (!isValidCoordinate(st.lat, st.lng) || !st.address?.trim()) return false;
      if (platformSettings.store_visibility_rule === 'approved_active_open_only' && st.is_open === false) {
        return false;
      }
      if (cityFilter && !(st.city || '').toLowerCase().includes(cityFilter) && !(st.address || '').toLowerCase().includes(cityFilter)) {
        return false;
      }
      if (stateFilter && !(st.state || '').toLowerCase().includes(stateFilter) && !(st.address || '').toLowerCase().includes(stateFilter)) {
        return false;
      }
      if (districtFilter && !(st.district || '').toLowerCase().includes(districtFilter) && !(st.address || '').toLowerCase().includes(districtFilter)) {
        return false;
      }
      if (pincodeFilter && (st.pincode || '') !== pincodeFilter) {
        return false;
      }
      return true;
    });
    const allProducts = await productsRepo.list({ includeWholesale: false });

    const productCountMap: Record<number, number> = {};
    const availableProductNamesMap: Record<number, string[]> = {};
    const availableProductSearchTermsMap: Record<number, string[]> = {};
    for (const p of allProducts) {
      if (p.store_id) {
        productCountMap[p.store_id] = (productCountMap[p.store_id] || 0) + 1;
        if (p.is_active !== false && !p.is_deleted && Number(p.stock) > 0 && p.name) {
          if (!availableProductNamesMap[p.store_id]) {
            availableProductNamesMap[p.store_id] = [];
            availableProductSearchTermsMap[p.store_id] = [];
          }
          availableProductNamesMap[p.store_id].push(p.name);
          availableProductSearchTermsMap[p.store_id].push(p.name.toLowerCase());
          if (p.brand) {
            availableProductSearchTermsMap[p.store_id].push(String(p.brand).toLowerCase());
          }
        }
      }
    }

    let enriched = approvedStores.map(st => {
      const distKm = hasCoords
        ? Math.round(calculateHaversineKm(qLat, qLng, st.lat, st.lng) * 100) / 100
        : null;
      return sanitizePublicStore(st, {
        distance_km: distKm,
        product_count: productCountMap[st.id] || 0,
        available_product_names: availableProductNamesMap[st.id] || []
      });
    });

    if (search) {
      enriched = enriched.filter(
        st =>
          st.name.toLowerCase().includes(search) ||
          st.address.toLowerCase().includes(search) ||
          (st.landmark && st.landmark.toLowerCase().includes(search)) ||
          (st.city && st.city.toLowerCase().includes(search)) ||
          (st.district && st.district.toLowerCase().includes(search)) ||
          (st.state && st.state.toLowerCase().includes(search)) ||
          (st.pincode && st.pincode.includes(search)) ||
          (st.description && st.description.toLowerCase().includes(search)) ||
          (Array.isArray(availableProductSearchTermsMap[st.id]) &&
            availableProductSearchTermsMap[st.id].some(term => term.includes(search)))
      );
    }

    if (hasCoords) {
      enriched.sort((a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));
    } else {
      enriched.sort((a, b) => (b.product_count ?? 0) - (a.product_count ?? 0) || b.id - a.id);
    }
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/stores/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const store = await storesRepo.findById(id);
    if (
      !store ||
      store.approval_status !== 'approved' ||
      store.is_active === false ||
      !isValidCoordinate(store.lat, store.lng) ||
      !store.address?.trim()
    ) {
      return res.status(404).json({ error: 'Store not found or unavailable.' });
    }
    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const distKm = isValidCoordinate(qLat, qLng)
      ? Math.round(calculateHaversineKm(qLat, qLng, store.lat, store.lng) * 100) / 100
      : null;
    const storeProds = await productsRepo.list({ store_id: id, includeWholesale: false });

    res.json(
      sanitizePublicStore(store, {
        distance_km: distKm,
        product_count: storeProds.length
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/stores/:id/products', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const store = await storesRepo.findById(id);
    if (
      !store ||
      store.approval_status !== 'approved' ||
      store.is_active === false ||
      !isValidCoordinate(store.lat, store.lng)
    ) {
      return res.status(404).json({ error: 'Store not found or unavailable.' });
    }
    const { category, search, in_stock } = req.query;
    const products = await productsRepo.list({
      store_id: id,
      category: category as string,
      search: search as string,
      in_stock: in_stock === 'true',
      includeZeroStockUnavailable: true,
      includeWholesale: false
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/stores/:id/delivery-quote', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const store = await storesRepo.findById(id);
    if (!store || store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(404).json({ error: 'Store not found or unavailable.' });
    }

    const cLat = Number(req.body?.customer_lat);
    const cLng = Number(req.body?.customer_lng);
    if (!isValidCoordinate(cLat, cLng)) {
      return res.status(400).json({ error: 'Valid delivery coordinates are required.' });
    }

    const road = await calculateRoadDistanceKm(store.lat, store.lng, cLat, cLng);
    const radius = Math.max(0.5, Number(store.delivery_radius_km) || 5);
    const deliverable =
      (store.service_type === 'delivery' || store.service_type === 'both') && road.distance_km <= radius;

    res.json({
      deliverable,
      distance_km: road.distance_km,
      duration_mins: road.duration_mins,
      distance_source: road.source,
      delivery_fee: Math.max(0, Number(store.delivery_fee || 0)),
      handling_fee: 0,
      max_delivery_distance_km: radius,
      pricing_mode: 'slabs',
      matched_slab_label:
        Number(store.delivery_fee || 0) === 0
          ? 'Free Store-Managed Delivery'
          : `Store-Managed Delivery (₹${store.delivery_fee})`,
      warehouse_lat: store.lat,
      warehouse_lng: store.lng,
      warehouse_address: store.address,
      reason: !deliverable
        ? store.service_type === 'pickup'
          ? `${store.name} supports Store Pickup only.`
          : `Delivery unavailable beyond ${radius} km for ${store.name}. Your location is ${road.distance_km} km away.`
        : undefined
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to compute store delivery distance.' });
  }
});

// ----------------------------------------------------
// Store Owner Dashboard Routes (Strict Store Ownership Isolation)
// ----------------------------------------------------
async function getStoreForOwnerOr404(ownerId: number) {
  const store = await storesRepo.findByOwnerId(ownerId);
  return store;
}

app.get('/api/store-owner/my-store', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) {
      return res.status(404).json({ error: 'No store found for this owner account.' });
    }
    const products = await productsRepo.list({ store_id: store.id, includeInactive: true, includeWholesale: false });
    const orders = await ordersRepo.list({ store_id: store.id });

    const availableProducts = products.filter(p => p.is_active !== false && Number(p.stock) > 0).length;
    const unavailableProducts = products.length - availableProducts;
    const newOrders = orders.filter(o => o.status === 'placed').length;
    const inProgressOrders = orders.filter(o => ['confirmed', 'packed', 'dispatched'].includes(o.status)).length;
    const completedOrders = orders.filter(o => o.status === 'delivered').length;
    const cancelledOrders = orders.filter(o => o.status === 'cancelled').length;
    // Completed sales only — cancelled/rejected orders are strictly excluded
    const completedSales = Math.round(
      orders
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + Number(o.total_amount || 0), 0) * 100
    ) / 100;

    res.json({
      store,
      stats: {
        total_products: products.length,
        available_products: availableProducts,
        unavailable_products: unavailableProducts,
        active_products: availableProducts,
        total_orders: orders.length,
        new_orders: newOrders,
        pending_orders: newOrders,
        active_orders: inProgressOrders,
        in_progress_orders: inProgressOrders,
        completed_orders: completedOrders,
        cancelled_orders: cancelledOrders,
        gross_order_value: completedSales,
        platform_fee: 0,
        net_earnings: completedSales,
        total_revenue: completedSales
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/store-owner/my-store', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) {
      return res.status(404).json({ error: 'Store not found.' });
    }
    if (store.is_active === false) {
      return res.status(403).json({ error: 'Your store has been suspended by Admin.' });
    }

    // Strict security guard: store owners cannot self-approve, unsuspend, or hijack store ownership/monetization flags
    if (
      req.body.approval_status !== undefined ||
      req.body.is_active !== undefined ||
      req.body.owner_id !== undefined ||
      req.body.featured !== undefined ||
      req.body.subscription_tier !== undefined
    ) {
      return res.status(403).json({
        error: 'Forbidden: Approval status and platform administrative flags cannot be modified by store owners.'
      });
    }

    const {
      name,
      description,
      email,
      owner_phone,
      address,
      landmark,
      city,
      district,
      state,
      pincode,
      lat,
      lng,
      logo_url,
      banner_url,
      photos,
      opening_hours,
      opening_time,
      closing_time,
      weekly_closed_days,
      service_type,
      delivery_radius_km,
      delivery_fee,
      min_order_amount,
      delivery_info,
      is_open
    } = req.body;

    const cleanEmail = email !== undefined ? String(email).trim() : undefined;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid store email address.' });
    }
    const cleanPincode = pincode !== undefined ? String(pincode).trim() : undefined;
    if (cleanPincode && !/^\d{6}$/.test(cleanPincode)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit Indian PIN code.' });
    }

    let nextLat = store.lat;
    let nextLng = store.lng;
    if (lat !== undefined || lng !== undefined) {
      const cLat = Number(lat);
      const cLng = Number(lng);
      if (!isValidCoordinate(cLat, cLng)) {
        return res.status(400).json({ error: 'Invalid map coordinates.' });
      }
      nextLat = cLat;
      nextLng = cLng;
    }

    let cleanOwnerPhone = store.owner_phone;
    if (owner_phone !== undefined) {
      const normalized = normalizePhone(owner_phone);
      if (normalized.length !== 10) {
        return res.status(400).json({ error: 'Store contact mobile number must be a valid 10-digit number.' });
      }
      cleanOwnerPhone = normalized;
    }

    if (delivery_fee !== undefined && (!Number.isFinite(Number(delivery_fee)) || Number(delivery_fee) < 0)) {
      return res.status(400).json({ error: 'Delivery fee must be a valid non-negative amount.' });
    }
    if (min_order_amount !== undefined && (!Number.isFinite(Number(min_order_amount)) || Number(min_order_amount) < 0)) {
      return res.status(400).json({ error: 'Minimum order amount must be a valid non-negative amount.' });
    }
    if (delivery_radius_km !== undefined && (!Number.isFinite(Number(delivery_radius_km)) || Number(delivery_radius_km) < 0.5)) {
      return res.status(400).json({ error: 'Delivery radius must be at least 0.5 km.' });
    }

    const validDaysSet = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const nextClosedDays = Array.isArray(weekly_closed_days)
      ? Array.from(new Set(weekly_closed_days.map((d: any) => String(d).trim()).filter(d => validDaysSet.has(d))))
      : store.weekly_closed_days || [];

    const nextOpeningTime = opening_time !== undefined ? (opening_time ? String(opening_time).trim() : null) : store.opening_time || null;
    const nextClosingTime = closing_time !== undefined ? (closing_time ? String(closing_time).trim() : null) : store.closing_time || null;

    let nextOpeningHours = opening_hours ? String(opening_hours).trim() : store.opening_hours;
    if (!opening_hours && (opening_time !== undefined || closing_time !== undefined || weekly_closed_days !== undefined)) {
      if (nextOpeningTime && nextClosingTime) {
        const closedSuffix = nextClosedDays.length > 0 ? ` · Closed: ${nextClosedDays.join(', ')}` : '';
        nextOpeningHours = `${formatTime12h(nextOpeningTime)} - ${formatTime12h(nextClosingTime)}${closedSuffix}`;
      }
    }

    const nextLogo = logo_url !== undefined ? (logo_url ? sanitizeImageValue(logo_url) : null) : (store.logo_url || null);
    const nextBanner = banner_url !== undefined ? (banner_url ? sanitizeImageValue(banner_url) : null) : (store.banner_url || null);

    let nextPhotos = photos !== undefined ? sanitizeStorePhotos(photos) : [...(Array.isArray(store.photos) ? store.photos : [])];
    if (logo_url !== undefined || banner_url !== undefined) {
      const oldSpecials = new Set([store.banner_url, store.logo_url].filter(Boolean));
      const extras = nextPhotos.filter(p => !oldSpecials.has(p) && p !== nextBanner && p !== nextLogo);
      nextPhotos = [nextBanner, nextLogo, ...extras].filter((x): x is string => Boolean(x)).slice(0, 4);
    }

    const patch: Partial<StoreDoc> = {
      ...(name !== undefined && String(name).trim() ? { name: String(name).trim() } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(cleanEmail !== undefined ? { email: cleanEmail || null } : {}),
      owner_phone: cleanOwnerPhone,
      ...(address !== undefined && String(address).trim() ? { address: String(address).trim() } : {}),
      ...(landmark !== undefined ? { landmark: landmark ? String(landmark).trim() : null } : {}),
      ...(city !== undefined ? { city: String(city).trim() } : {}),
      ...(district !== undefined ? { district: district ? String(district).trim() : null } : {}),
      ...(state !== undefined ? { state: state ? String(state).trim() : null } : {}),
      ...(cleanPincode !== undefined ? { pincode: cleanPincode } : {}),
      lat: nextLat,
      lng: nextLng,
      logo_url: nextLogo,
      banner_url: nextBanner,
      photos: nextPhotos,
      opening_hours: nextOpeningHours,
      opening_time: nextOpeningTime,
      closing_time: nextClosingTime,
      weekly_closed_days: nextClosedDays,
      ...(service_type && ['delivery', 'pickup', 'both'].includes(service_type) ? { service_type } : {}),
      ...(delivery_radius_km !== undefined ? { delivery_radius_km: Math.max(0.5, Number(delivery_radius_km)) } : {}),
      ...(delivery_fee !== undefined ? { delivery_fee: Math.max(0, Number(delivery_fee)) } : {}),
      ...(min_order_amount !== undefined ? { min_order_amount: Math.max(0, Number(min_order_amount)) } : {}),
      ...(delivery_info !== undefined ? { delivery_info: delivery_info ? String(delivery_info).trim() : null } : {}),
      ...(is_open !== undefined ? { is_open: Boolean(is_open) } : {})
    };

    const updated = await storesRepo.update(store.id, patch);
    await logAudit(req.user!.id, 'store_owner', 'STORE_UPDATED', 'stores', store.id, `Updated store profile (${updated?.name})`);
    res.json({ message: 'Store settings updated successfully.', store: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/store-owner/products', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    const products = await productsRepo.list({
      store_id: store.id,
      includeInactive: true,
      includeWholesale: false
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/store-owner/products', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(403).json({ error: 'Your store must be approved and active to manage products.' });
    }

    const {
      category_id,
      name,
      brand,
      unit,
      price,
      mrp,
      stock,
      image_url,
      description,
      is_active,
      product_type,
      min_order_qty,
      max_order_qty,
      pricing_slabs
    } = req.body;

    if (!name || !String(name).trim() || !unit || !String(unit).trim() || price === undefined || price === '') {
      return res.status(400).json({ error: 'Product name, unit, and selling price are required.' });
    }

    const numPrice = Number(price);
    const numMrp = mrp !== undefined && mrp !== null && mrp !== '' ? Number(mrp) : numPrice;
    const rawStock = stock !== undefined && stock !== null && stock !== '' ? Number(stock) : 0;

    if (!Number.isFinite(numPrice) || numPrice < 0) {
      return res.status(400).json({ error: 'Selling price cannot be negative.' });
    }
    if (!Number.isFinite(numMrp) || numMrp < 0) {
      return res.status(400).json({ error: 'MRP cannot be negative.' });
    }
    if (!Number.isFinite(rawStock) || rawStock < 0) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative.' });
    }

    const numStock = Math.round(rawStock * 100) / 100;
    if (numStock <= 0 && is_active === true) {
      return res.status(400).json({ error: 'Cannot mark a product with 0 stock as available. Increase stock above 0 first.' });
    }
    const resolvedIsActive = numStock <= 0 ? false : (is_active === undefined ? true : Boolean(is_active));

    const discount = numMrp > numPrice && numMrp > 0 ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;
    const resolvedType = normalizeProductType(product_type, String(unit).trim());
    const minOrderQty =
      min_order_qty !== undefined && min_order_qty !== null && min_order_qty !== ''
        ? Number(min_order_qty)
        : 1;
    const maxOrderQty =
      max_order_qty !== undefined && max_order_qty !== null && max_order_qty !== ''
        ? Number(max_order_qty)
        : null;

    const slabCheck = validateAdminPriceSlabs(pricing_slabs, resolvedType);
    if (!slabCheck.valid) {
      return res.status(400).json({ error: slabCheck.error });
    }

    const cleanImageUrl = image_url ? sanitizeImageValue(image_url) : null;

    const product = await productsRepo.create({
      category_id: Number(category_id) || 1,
      store_id: store.id,
      store_name: store.name,
      name: String(name).trim(),
      brand: brand ? String(brand).trim().slice(0, 80) : null,
      unit: String(unit).trim(),
      price: numPrice,
      mrp: numMrp,
      discount_percent: discount,
      stock: numStock,
      image_url: cleanImageUrl,
      description: description ? String(description).trim() : null,
      is_active: resolvedIsActive,
      is_deleted: false,
      product_type: resolvedType,
      min_order_qty: minOrderQty,
      max_order_qty: maxOrderQty,
      pricing_slabs: slabCheck.slabs,
      created_at: new Date().toISOString()
    });

    await logAudit(req.user!.id, 'store_owner', 'STORE_PRODUCT_CREATED', 'products', product.id, `Store ${store.name} added ${product.name}`);
    res.status(201).json(sanitizeProductForCustomer(product));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/store-owner/products/:id', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(403).json({ error: 'Your store must be approved and active to edit products.' });
    }

    const id = parseInt(req.params.id, 10);
    const existing = await productsRepo.findById(id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (existing.store_id !== store.id) {
      return res.status(403).json({ error: 'Forbidden: You can only edit products belonging to your own store.' });
    }

    const {
      category_id,
      name,
      brand,
      unit,
      price,
      mrp,
      stock,
      image_url,
      description,
      is_active,
      product_type,
      min_order_qty,
      max_order_qty,
      pricing_slabs
    } = req.body;

    const numPrice = price !== undefined ? Number(price) : Number(existing.price);
    const numMrp = mrp !== undefined && mrp !== null && mrp !== '' ? Number(mrp) : Number(existing.mrp ?? numPrice);
    const rawStock = stock !== undefined ? Number(stock) : Number(existing.stock);

    if (!Number.isFinite(numPrice) || numPrice < 0) {
      return res.status(400).json({ error: 'Selling price cannot be negative.' });
    }
    if (!Number.isFinite(numMrp) || numMrp < 0) {
      return res.status(400).json({ error: 'MRP cannot be negative.' });
    }
    if (!Number.isFinite(rawStock) || rawStock < 0) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative.' });
    }

    const numStock = Math.round(rawStock * 100) / 100;
    if (numStock <= 0 && is_active === true) {
      return res.status(400).json({ error: 'Cannot mark a product with 0 stock as available. Increase stock above 0 first.' });
    }

    let resolvedIsActive: boolean;
    if (numStock <= 0) {
      resolvedIsActive = false;
    } else if (is_active !== undefined) {
      resolvedIsActive = Boolean(is_active);
    } else if (existing.stock <= 0 && numStock > 0) {
      resolvedIsActive = true;
    } else {
      resolvedIsActive = existing.is_active !== false;
    }

    const discount = numMrp > numPrice && numMrp > 0 ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;

    const resolvedType = product_type !== undefined
      ? normalizeProductType(product_type, unit ? String(unit).trim() : existing.unit)
      : normalizeProductType(existing.product_type, existing.unit);

    let slabsPatch: Record<string, any> = {};
    if (pricing_slabs !== undefined) {
      const slabCheck = validateAdminPriceSlabs(pricing_slabs, resolvedType);
      if (!slabCheck.valid) {
        return res.status(400).json({ error: slabCheck.error });
      }
      slabsPatch = { pricing_slabs: slabCheck.slabs };
    }

    const cleanImageUrl = image_url !== undefined ? (image_url ? sanitizeImageValue(image_url) : null) : existing.image_url;

    const updated = await productsRepo.update(id, {
      ...(category_id !== undefined ? { category_id: Number(category_id) } : {}),
      ...(name ? { name: String(name).trim() } : {}),
      ...(brand !== undefined ? { brand: brand ? String(brand).trim().slice(0, 80) : null } : {}),
      ...(unit ? { unit: String(unit).trim() } : {}),
      ...(price !== undefined ? { price: numPrice } : {}),
      ...(mrp !== undefined ? { mrp: numMrp } : {}),
      discount_percent: discount,
      ...(stock !== undefined ? { stock: numStock } : {}),
      image_url: cleanImageUrl,
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      is_active: resolvedIsActive,
      product_type: resolvedType,
      ...(min_order_qty !== undefined ? { min_order_qty: Number(min_order_qty) || 1 } : {}),
      ...(max_order_qty !== undefined ? { max_order_qty: max_order_qty ? Number(max_order_qty) : null } : {}),
      ...slabsPatch
    });

    await logAudit(req.user!.id, 'store_owner', 'STORE_PRODUCT_UPDATED', 'products', id, `Store ${store.name} updated product #${id}`);
    res.json(sanitizeProductForCustomer(updated!));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/store-owner/products/:id/stock', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(403).json({ error: 'Your store must be approved and active to update inventory.' });
    }

    const id = parseInt(req.params.id, 10);
    const existing = await productsRepo.findById(id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (existing.store_id !== store.id) {
      return res.status(403).json({ error: 'Forbidden: You can only adjust inventory belonging to your own store.' });
    }

    const rawStock = req.body?.stock;
    if (rawStock === undefined || rawStock === null || rawStock === '') {
      return res.status(400).json({ error: 'Stock quantity is required.' });
    }
    const parsedStock = Number(rawStock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative.' });
    }
    const newStock = Math.round(parsedStock * 100) / 100;
    if (newStock <= 0 && req.body?.is_active === true) {
      return res.status(400).json({ error: 'Cannot mark a product with 0 stock as available.' });
    }

    const updated = await productsRepo.storeAdjustStock(
      id,
      newStock,
      store.id,
      typeof req.body?.is_active === 'boolean' ? req.body.is_active : undefined
    );

    await logAudit(
      req.user!.id,
      'store_owner',
      'STORE_STOCK_UPDATED',
      'products',
      id,
      `Store ${store.name} updated stock for "${existing.name}" to ${newStock}`
    );
    res.json(sanitizeProductForCustomer(updated));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/store-owner/products/:id', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    const id = parseInt(req.params.id, 10);
    const existing = await productsRepo.findById(id);
    if (!existing || existing.is_deleted) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (existing.store_id !== store.id) {
      return res.status(403).json({ error: 'Forbidden: You can only delete products belonging to your own store.' });
    }

    const referencedInOrders = await productsRepo.isProductReferencedInOrders(id);
    await productsRepo.softDelete(id);
    await logAudit(req.user!.id, 'store_owner', 'STORE_PRODUCT_DELETED', 'products', id, `Store ${store.name} removed product #${id}`);
    res.json({
      message: referencedInOrders
        ? 'Product is linked to existing orders and has been safely deactivated while preserving order history.'
        : 'Product deleted successfully.',
      referenced_in_orders: referencedInOrders
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/store-owner/inventory-logs', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    const logs = await productsRepo.listInventoryLogsForStore(store.id, 60);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/store-owner/orders', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    const orders = await ordersRepo.list({ store_id: store.id });
    const itemsSnap = await getDocs(collection(firestoreDb, 'order_items'));
    const itemsByOrder = new Map<number, any[]>();
    for (const d of itemsSnap.docs) {
      const it = d.data();
      if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
      itemsByOrder.get(it.order_id)!.push(it);
    }

    res.json(
      orders.map(o => {
        const needsDeliveryAddress =
          o.fulfillment_type !== 'pickup' && !['delivered', 'cancelled'].includes(o.status);
        return {
          ...o,
          delivery_otp: undefined,
          pickup_code: undefined,
          delivery_address:
            o.fulfillment_type === 'pickup'
              ? o.delivery_address
              : needsDeliveryAddress
                ? o.delivery_address
                : o.status === 'cancelled'
                  ? 'Order cancelled — delivery address hidden'
                  : 'Delivered — street address hidden after fulfillment',
          landmark: needsDeliveryAddress ? o.landmark : '',
          customer_lat: needsDeliveryAddress ? o.customer_lat : null,
          customer_lng: needsDeliveryAddress ? o.customer_lng : null,
          items: itemsByOrder.get(o.id) || []
        };
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

const ALLOWED_STORE_ORDER_TRANSITIONS: Record<string, string[]> = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: []
};

app.put('/api/store-owner/orders/:id/status', requireAuth, requireRole(['store_owner']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const store = await getStoreForOwnerOr404(req.user!.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (store.approval_status !== 'approved' || store.is_active === false) {
      return res.status(403).json({ error: 'Your store must be approved and active to manage orders.' });
    }

    const id = parseInt(req.params.id, 10);
    const { order } = await ordersRepo.findById(id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.store_id !== store.id) {
      return res.status(403).json({ error: 'Forbidden: This order belongs to another store.' });
    }

    const { status, rejection_reason, pickup_code } = req.body;
    if (!['confirmed', 'packed', 'dispatched', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid order status.' });
    }

    const allowedNext = ALLOWED_STORE_ORDER_TRANSITIONS[order.status] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json({
        error: `Invalid order status transition from "${order.status}" to "${status}".`
      });
    }

    if (status === 'cancelled') {
      const adminUsers = await usersRepo.listAdmins();
      const reason = rejection_reason?.trim() || `Rejected by ${store.name}`;
      const cancelled = await ordersRepo.cancelOrderTransactional(
        id,
        reason,
        { id: req.user!.id, name: store.name, role: 'store_owner' },
        adminUsers
      );
      await logAudit(req.user!.id, 'store_owner', 'STORE_ORDER_REJECTED', 'orders', id, `Store ${store.name} rejected order #${order.order_number}`);
      return res.json({ ...cancelled, pickup_code: undefined, delivery_otp: undefined });
    }

    if (status === 'delivered' && order.fulfillment_type === 'pickup') {
      const code = String(pickup_code || '').trim();
      if (!code) {
        return res.status(400).json({ error: 'Please enter the customer 6-digit pickup code to complete this pickup order.' });
      }
      const completed = await ordersRepo.verifyPickupAndComplete(id, store.id, code, store.name);
      await logAudit(req.user!.id, 'store_owner', 'STORE_PICKUP_VERIFIED', 'orders', id, `Store ${store.name} verified pickup code and completed order #${order.order_number}`);
      return res.json({ ...completed, pickup_code: undefined, delivery_otp: undefined });
    }

    const extra =
      status === 'delivered'
        ? { payment_status: 'paid' as const, cod_collected: true, cod_collected_at: new Date().toISOString() }
        : undefined;

    const updated = await ordersRepo.updateStatus(id, status, extra);
    await logAudit(req.user!.id, 'store_owner', 'STORE_ORDER_STATUS', 'orders', id, `Store ${store.name} marked order #${order.order_number} as ${status}`);
    res.json(updated ? { ...updated, pickup_code: undefined, delivery_otp: undefined } : updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Complaints / Reported Problems (Customers & Store Owners -> Admin)
// ----------------------------------------------------
app.post('/api/complaints', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subject, description, store_id, order_id, product_id } = req.body;
    if (!subject?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'Subject and problem description are required.' });
    }

    let storeName: string | null = null;
    if (store_id) {
      const st = await storesRepo.findById(Number(store_id));
      if (!st) {
        return res.status(404).json({ error: 'Referenced store not found.' });
      }
      storeName = st.name;
    }

    let orderNumber: string | null = null;
    if (order_id) {
      const { order } = await ordersRepo.findById(Number(order_id));
      if (!order) {
        return res.status(404).json({ error: 'Referenced order not found.' });
      }
      if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden: You can only report issues on your own orders.' });
      }
      if (req.user!.role === 'store_owner') {
        const myStore = await storesRepo.findByOwnerId(req.user!.id);
        if (!myStore || order.store_id !== myStore.id) {
          return res.status(403).json({ error: 'Forbidden: You can only report issues on orders belonging to your store.' });
        }
      }
      orderNumber = order.order_number;
    }

    let productName: string | null = null;
    if (product_id) {
      const prod = await productsRepo.findById(Number(product_id));
      if (!prod) {
        return res.status(404).json({ error: 'Referenced product not found.' });
      }
      productName = prod.name;
    }

    const complaint = await complaintsRepo.create({
      reporter_id: req.user!.id,
      reporter_name: req.user!.name,
      reporter_phone: req.user!.phone,
      reporter_role: req.user!.role,
      store_id: store_id ? Number(store_id) : null,
      store_name: storeName,
      order_id: order_id ? Number(order_id) : null,
      order_number: orderNumber,
      product_id: product_id ? Number(product_id) : null,
      product_name: productName,
      subject: String(subject).trim(),
      description: String(description).trim(),
      status: 'open',
      admin_notes: null,
      resolved_at: null
    });

    const admins = await usersRepo.listAdmins();
    for (const adm of admins) {
      await notificationsRepo.create({
        user_id: adm.id,
        title: 'New Issue Reported 📋',
        message: `${req.user!.name} (${req.user!.role}) reported: ${complaint.subject}`,
        type: 'complaint'
      });
    }

    await logAudit(req.user!.id, req.user!.role, 'COMPLAINT_SUBMITTED', 'complaints', complaint.id, complaint.subject);
    res.status(201).json(complaint);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/complaints/my', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await complaintsRepo.listByReporter(req.user!.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

// ----------------------------------------------------
// Admin Marketplace Control Routes (Stores, Customers, Categories, Complaints)
// ----------------------------------------------------
app.get('/api/admin/stores', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stores = await storesRepo.listAll();
    const products = await productsRepo.list({ includeInactive: true, includeWholesale: false });
    const orders = await ordersRepo.list();

    const prodCounts: Record<number, number> = {};
    for (const p of products) {
      if (p.store_id) prodCounts[p.store_id] = (prodCounts[p.store_id] || 0) + 1;
    }
    const orderCounts: Record<number, number> = {};
    for (const o of orders) {
      if (o.store_id) orderCounts[o.store_id] = (orderCounts[o.store_id] || 0) + 1;
    }

    res.json(
      stores.map(s => ({
        ...s,
        product_count: prodCounts[s.id] || 0,
        order_count: orderCounts[s.id] || 0
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/admin/stores/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const store = await storesRepo.findById(id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });

    const [products, orders, itemsMap, allComplaints] = await Promise.all([
      productsRepo.list({ store_id: id, includeInactive: true, includeWholesale: false }),
      ordersRepo.list({ store_id: id }),
      ordersRepo.listItemsMap(),
      complaintsRepo.listAll()
    ]);

    const enrichedOrders = orders.map(o => ({
      ...o,
      customer_phone: maskPhone(o.customer_phone),
      delivery_address: maskAddress(o.delivery_address),
      delivery_otp: undefined,
      pickup_code: undefined,
      items: itemsMap.get(o.id) || []
    }));
    const storeComplaints = allComplaints.filter(c => c.store_id === id);

    res.json({
      store: {
        ...store,
        product_count: products.length,
        order_count: orders.length
      },
      products,
      orders: enrichedOrders,
      complaints: storeComplaints
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/admin/stores/:id/approval', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { approval_status, rejection_reason } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(approval_status)) {
      return res.status(400).json({ error: 'Invalid approval status.' });
    }

    const existing = await storesRepo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Store not found.' });

    const updated = await storesRepo.update(id, {
      approval_status,
      rejection_reason: approval_status === 'rejected' ? (rejection_reason?.trim() || 'Not approved by Admin') : null,
      ...(approval_status === 'approved' ? { is_active: true } : {})
    });

    await notificationsRepo.create({
      user_id: existing.owner_id,
      title: approval_status === 'approved' ? 'Store Approved! 🎉' : 'Store Registration Update',
      message:
        approval_status === 'approved'
          ? `Congratulations! ${existing.name} is now approved and live for nearby customers on FMP Supermart.`
          : `Your store registration for ${existing.name} was ${approval_status}. ${rejection_reason || ''}`,
      type: 'store'
    });

    await logAudit(req.user!.id, 'admin', 'STORE_APPROVAL_UPDATED', 'stores', id, `Set store ${existing.name} approval to ${approval_status}`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/stores/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { is_active } = req.body;
    const existing = await storesRepo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Store not found.' });

    if (Boolean(is_active) && existing.approval_status !== 'approved') {
      return res.status(400).json({ error: 'Only approved stores can be activated.' });
    }

    const updated = await storesRepo.update(id, { is_active: Boolean(is_active) });
    await notificationsRepo.create({
      user_id: existing.owner_id,
      title: is_active ? 'Store Activated ✅' : 'Store Suspended ⚠️',
      message: is_active
        ? `${existing.name} has been reactivated by Admin.`
        : `${existing.name} has been temporarily deactivated by Admin.`,
      type: 'store'
    });

    await logAudit(req.user!.id, 'admin', 'STORE_ACTIVE_TOGGLED', 'stores', id, `Store ${existing.name} is_active=${Boolean(is_active)}`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/customers', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const customers = await usersRepo.listCustomers();
    const orders = await ordersRepo.list();
    const statsByCustomer: Record<number, { orders: number; total_spent: number }> = {};
    for (const o of orders) {
      if (!statsByCustomer[o.customer_id]) {
        statsByCustomer[o.customer_id] = { orders: 0, total_spent: 0 };
      }
      statsByCustomer[o.customer_id].orders++;
      if (o.status !== 'cancelled') {
        statsByCustomer[o.customer_id].total_spent += Number(o.total_amount || 0);
      }
    }

    res.json(
      customers.map(({ password_hash: _pw, ...safeUser }) => ({
        id: safeUser.id,
        name: safeUser.name,
        role: safeUser.role,
        phone: maskPhone(safeUser.phone),
        masked_phone: maskPhone(safeUser.phone),
        address: maskAddress(safeUser.address),
        masked_address: maskAddress(safeUser.address),
        city: safeUser.city,
        pincode: safeUser.pincode,
        is_active: safeUser.is_active,
        created_at: safeUser.created_at,
        order_count: statsByCustomer[safeUser.id]?.orders || 0,
        total_spent: Math.round((statsByCustomer[safeUser.id]?.total_spent || 0) * 100) / 100
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/admin/customers/:id/orders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const customer = await usersRepo.findById(id);
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const [orders, itemsMap, allComplaints] = await Promise.all([
      ordersRepo.list({ customer_id: id }),
      ordersRepo.listItemsMap(),
      complaintsRepo.listByReporter(id)
    ]);

    const totalSpent = orders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        role: customer.role,
        phone: maskPhone(customer.phone),
        masked_phone: maskPhone(customer.phone),
        address: maskAddress(customer.address),
        masked_address: maskAddress(customer.address),
        city: customer.city,
        pincode: customer.pincode,
        is_active: customer.is_active,
        created_at: customer.created_at,
        order_count: orders.length,
        total_spent: Math.round(totalSpent * 100) / 100
      },
      orders: orders.map(o => ({
        ...o,
        customer_phone: maskPhone(o.customer_phone),
        delivery_address: maskAddress(o.delivery_address),
        delivery_otp: undefined,
        pickup_code: undefined,
        items: itemsMap.get(o.id) || []
      })),
      complaints: allComplaints
    });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/admin/customers/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { is_active } = req.body;
    const customer = await usersRepo.findById(id);
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ error: 'Customer not found.' });
    }
    const updated = await usersRepo.update(id, { is_active: Boolean(is_active) });
    if (!updated) return res.status(404).json({ error: 'Customer not found.' });
    await logAudit(req.user!.id, 'admin', 'CUSTOMER_STATUS_UPDATED', 'users', id, `Customer ${customer.name} is_active=${Boolean(is_active)}`);
    res.json({
      id: updated.id,
      name: updated.name,
      role: updated.role,
      phone: maskPhone(updated.phone),
      masked_phone: maskPhone(updated.phone),
      address: maskAddress(updated.address),
      city: updated.city,
      pincode: updated.pincode,
      is_active: updated.is_active,
      created_at: updated.created_at
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/categories', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await categoriesRepo.list(true);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.post('/api/admin/categories', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, image_url, display_order } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Category name is required.' });
    }
    const cleanName = String(name).trim();
    const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cat-${Date.now()}`;
    const cleanImg = image_url ? sanitizeImageValue(image_url) : '';
    const created = await categoriesRepo.create({
      name: cleanName,
      slug,
      description: description?.trim() || '',
      image_url: cleanImg || '',
      display_order: Number(display_order) || 10,
      is_active: true
    });
    await logAudit(req.user!.id, 'admin', 'CATEGORY_CREATED', 'categories', created.id, `Created category ${cleanName}`);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/categories/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await categoriesRepo.findById(id);
    if (!existing) return res.status(404).json({ error: 'Category not found.' });

    const { name, description, image_url, display_order, is_active } = req.body;
    const cleanImg = image_url !== undefined ? (image_url ? sanitizeImageValue(image_url) : '') : undefined;
    const updated = await categoriesRepo.update(id, {
      ...(name ? { name: String(name).trim(), slug: String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : {}),
      ...(description !== undefined ? { description: String(description).trim() } : {}),
      ...(cleanImg !== undefined ? { image_url: cleanImg || '' } : {}),
      ...(display_order !== undefined ? { display_order: Number(display_order) } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {})
    });
    if (!updated) return res.status(404).json({ error: 'Category not found.' });
    const actionName =
      is_active !== undefined && Boolean(is_active) !== (existing.is_active !== false)
        ? Boolean(is_active)
          ? 'CATEGORY_ACTIVATED'
          : 'CATEGORY_DEACTIVATED'
        : 'CATEGORY_UPDATED';
    await logAudit(req.user!.id, 'admin', actionName, 'categories', id, `Updated category ${updated.name} (active=${updated.is_active !== false})`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/categories/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const allProducts = await productsRepo.list({ includeInactive: true, includeWholesale: true });
    if (allProducts.some(p => Number(p.category_id) === id)) {
      return res.status(400).json({
        error: 'Cannot delete a category linked to existing products. Deactivate it instead so existing products remain intact.'
      });
    }
    const ok = await categoriesRepo.remove(id);
    if (!ok) return res.status(404).json({ error: 'Category not found.' });
    await logAudit(req.user!.id, 'admin', 'CATEGORY_DELETED', 'categories', id, `Deleted category #${id}`);
    res.json({ message: 'Category deleted.' });
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.get('/api/admin/complaints', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await complaintsRepo.listAll();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: safeServerError(err) });
  }
});

app.put('/api/admin/complaints/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, admin_notes } = req.body;
    if (!['open', 'in_review', 'resolved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid complaint status.' });
    }
    const updated = await complaintsRepo.update(id, {
      status,
      ...(admin_notes !== undefined ? { admin_notes: String(admin_notes).trim() } : {}),
      resolved_at: status === 'resolved' || status === 'rejected' ? new Date().toISOString() : null
    });
    if (!updated) return res.status(404).json({ error: 'Complaint not found.' });

    await notificationsRepo.create({
      user_id: updated.reporter_id,
      title: `Support Ticket ${status.replace('_', ' ').toUpperCase()}`,
      message: `Your issue "${updated.subject}" was updated by Admin.${updated.admin_notes ? ` Note: ${updated.admin_notes}` : ''}`,
      type: 'complaint'
    });

    await logAudit(req.user!.id, 'admin', 'COMPLAINT_UPDATED', 'complaints', id, `Complaint #${id} set to ${status}`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 404 handler for unmatched API routes
app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
});

// ----------------------------------------------------
// Frontend Serving Setup (Dev via Vite middlewares, Prod via Express static)
// ----------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      if (url.startsWith('/api')) {
        return next();
      }
      try {
        const indexHtmlPath = path.resolve(__dirname, 'index.html');
        if (fs.existsSync(indexHtmlPath)) {
          let template = fs.readFileSync(indexHtmlPath, 'utf-8');
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
        } else {
          next();
        }
      } catch (e: any) {
        if (vite.ssrFixStacktrace) {
          vite.ssrFixStacktrace(e);
        }
        next(e);
      }
    });
  } else {
    const distPath =
      [
        __dirname,
        path.resolve(__dirname, 'dist'),
        path.resolve(process.cwd(), 'dist')
      ].find(p => fs.existsSync(path.resolve(p, 'index.html'))) || path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  // Global Express JSON error handler for malformed payloads or unexpected middleware errors
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = typeof err?.status === 'number' ? err.status : 500;
    const message = status >= 500 ? safeServerError(err) : (err?.message || 'Bad request');
    res.status(status).json({ error: message });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 FMP Supermart server running on port ${PORT} (${isProduction ? 'Production' : 'Development'})`);
    console.log(`📍 Serving India-Wide Hyperlocal Grocery Marketplace with Cloud Firestore`);
  });
}

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const isDirectRun = !isServerless && process.env.IS_TEST_SUITE !== 'true' && process.env.NODE_ENV !== 'test';
if (isDirectRun) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
  });
}

export default app;

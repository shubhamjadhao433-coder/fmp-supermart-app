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
  deliverySlotsRepo,
  notificationsRepo,
  favoritesRepo,
  reviewsRepo,
  suppliersRepo,
  purchaseOrdersRepo,
  codReconciliationsRepo,
  auditLogsRepo,
  passwordResetsRepo,
  storesRepo,
  complaintsRepo,
  addressesRepo,
  UserDoc,
  OrderDoc,
  StoreDoc,
  sanitizeProductForCustomer,
  computeWholesaleMetrics
} from './src/server/firestoreDb.ts';
import {
  requireAuth,
  requireRole,
  generateToken,
  logAudit,
  generateDeliveryOTP,
  AuthenticatedRequest
} from './src/server/auth.ts';
import {
  calculateRoadDistanceKm,
  calculateDeliveryFeeFromDistance,
  calculateHaversineKm,
  isValidCoordinate,
  normalizeDeliverySlabs,
  DEFAULT_WAREHOUSE_LAT,
  DEFAULT_WAREHOUSE_LNG
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
const PORT = process.env.NODE_ENV === 'production' && process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin || true);
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// Serve public directory for PWA assets, manifest, and icons
const publicDirPath = path.resolve(__dirname, 'public');
app.get(['/manifest.json', '/manifest.webmanifest'], (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.sendFile(path.resolve(publicDirPath, 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.resolve(publicDirPath, 'sw.js'));
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
      app: 'FMP Supermart Karanja Lad',
      timestamp: new Date().toISOString(),
      warehouse: {
        name: 'FMP Supermart Central Hub',
        location: 'Shivaji Chowk, Karanja Lad, Maharashtra 444105',
        type: 'Single Centralized Warehouse'
      },
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
        deliveryFeeModel: 'Admin Controlled Distance-Based Delivery (OSRM Road Distance Slabs & Per-KM)',
        handlingCharge: 5,
        paymentMode: 'Cash on Delivery (COD) Only',
        warehouseLocation: 'Karanja Lad Central Hub (444105)'
      }
    });
  } catch (err: any) {
    res.status(500).json({ status: 'unhealthy', error: err.message });
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

function sanitizeImageValue(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.slice(0, 1500);
  }
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[a-zA-Z0-9+/=]+$/i.test(trimmed)) {
    if (trimmed.length > 350000) {
      throw new Error('Uploaded image is too large. Please choose a smaller image.');
    }
    return trimmed;
  }
  return null;
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
  extra?: { distance_km?: number; product_count?: number; available_product_names?: string[] }
) {
  return {
    id: store.id,
    name: store.name,
    description: store.description || null,
    address: store.address,
    landmark: store.landmark || null,
    city: store.city,
    pincode: store.pincode,
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

app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { phone, name, email, password, address, landmark, pincode, role } = req.body;

    const cleanPhone = normalizePhone(phone);
    const cleanPassword = typeof password === 'string' ? password.trim() : '';

    if (!cleanPhone || !name || !cleanPassword) {
      return res.status(400).json({ error: 'Phone number, name, and password are required.' });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
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
      email: email?.trim() || null,
      role: userRole,
      password_hash: passwordHash,
      address: address ? address.trim() : null,
      landmark: landmark ? landmark.trim() : null,
      city: 'Karanja Lad',
      pincode: pincode || '444105',
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
      pincode: user.pincode
    };

    const token = generateToken(userPayload as any);
    await logAudit(user.id, user.role, 'USER_REGISTERED', 'users', user.id, `User ${user.name} registered as ${user.role}`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: userPayload
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
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
      return res.status(403).json({ error: 'Your account is deactivated. Please contact store admin at Karanja Lad (9699925206).' });
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
      pincode: matchedUser.pincode
    };

    const token = generateToken(userPayload as any);
    await logAudit(matchedUser.id, matchedUser.role, 'USER_LOGIN', 'users', matchedUser.id, `User ${matchedUser.name} logged in as ${matchedUser.role}`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      token,
      user: userPayload
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.json({ message: 'Logged out successfully.' });
});

// Secure Admin-Assisted Forgot Password Workflow
app.post('/api/auth/forgot-password-request', async (req: Request, res: Response) => {
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
      message: 'Password reset request registered successfully! The FMP Supermart central store admin has received your ticket.',
      support_phone: '9699925206',
      support_address: 'Karanja Lad, Maharashtra (444105)'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to process request: ' + err.message });
  }
});

// Admin view pending password reset requests
app.get('/api/admin/password-reset-requests', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await passwordResetsRepo.listPending();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    for (const u of users) {
      await usersRepo.update(u.id, { password_hash: newHash });
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user });
});

app.put('/api/auth/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, address, landmark, email } = req.body;
    const updatedUser = await usersRepo.update(req.user!.id, {
      ...(name ? { name: name.trim() } : {}),
      ...(address ? { address: address.trim() } : {}),
      ...(landmark ? { landmark: landmark.trim() } : {}),
      ...(email ? { email: email.trim() } : {})
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await logAudit(req.user!.id, req.user!.role, 'PROFILE_UPDATED', 'users', req.user!.id, `User updated profile information`);
    res.json({ message: 'Profile updated successfully', user: updatedUser });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    const numLat = lat !== undefined && lat !== null ? Number(lat) : null;
    const numLng = lng !== undefined && lng !== null ? Number(lng) : null;
    const hasCoords = numLat !== null && numLng !== null && isValidCoordinate(numLat, numLng);

    const saved = await addressesRepo.create(req.user!.id, {
      label: String(label || 'Home').trim().slice(0, 40) || 'Home',
      recipient_name: String(recipient_name || req.user!.name).trim(),
      phone: cleanPhone,
      address: cleanAddress,
      landmark: landmark ? String(landmark).trim() : '',
      pincode: pincode ? String(pincode).trim() : '444105',
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Delivery Settings & Delivery Slots Endpoints
// Admin has complete control over delivery fee & handling
// ----------------------------------------------------
app.get(['/api/settings/delivery', '/api/admin/settings/delivery'], async (req: Request, res: Response) => {
  try {
    const settings = await settingsRepo.getDeliverySettings();
    res.json({
      ...settings,
      default_delivery_fee: Number(settings.default_delivery_fee),
      handling_fee: Number(settings.handling_fee),
      min_order_amount: Number(settings.min_order_amount || 0),
      warehouse_lat: Number(settings.warehouse_lat),
      warehouse_lng: Number(settings.warehouse_lng),
      per_km_rate: Number(settings.per_km_rate),
      free_delivery_up_to_km: Number(settings.free_delivery_up_to_km || 0),
      max_delivery_distance_km: Number(settings.max_delivery_distance_km),
      delivery_slabs: normalizeDeliverySlabs(settings.delivery_slabs)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// Backend road distance & delivery fee calculation endpoint (OSRM + Admin rules)
app.post('/api/delivery/calculate-fee', async (req: Request, res: Response) => {
  try {
    const { customer_lat, customer_lng } = req.body;
    const cLat = Number(customer_lat);
    const cLng = Number(customer_lng);

    if (!isValidCoordinate(cLat, cLng)) {
      return res.status(400).json({ error: 'Valid delivery pin coordinates (latitude & longitude) are required.' });
    }

    const settings = await settingsRepo.getDeliverySettings();
    const road = await calculateRoadDistanceKm(
      settings.warehouse_lat,
      settings.warehouse_lng,
      cLat,
      cLng
    );

    const quote = calculateDeliveryFeeFromDistance(
      road.distance_km,
      road.duration_mins,
      road.source,
      settings
    );

    res.json(quote);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to calculate delivery distance.' });
  }
});

// OpenStreetMap Nominatim + Photon location search (supports local landmarks, chowks, roads & nearby areas)
app.get('/api/locations/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ query: q, results: [] });
    }

    const settings = await settingsRepo.getDeliverySettings();
    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const refLat = isValidCoordinate(qLat, qLng) ? qLat : settings.warehouse_lat;
    const refLng = isValidCoordinate(qLat, qLng) ? qLng : settings.warehouse_lng;

    const results = await searchOsmLocations(q, refLat, refLng);
    res.json({ query: q, results });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Unable to search OpenStreetMap areas right now.' });
  }
});

// OpenStreetMap reverse-geocoding endpoint for map pins, GPS, and selected search coordinates
app.get('/api/locations/reverse', async (req: Request, res: Response) => {
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

app.get('/api/delivery-slots', async (req: Request, res: Response) => {
  try {
    const slots = await deliverySlotsRepo.list();
    res.json(slots);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/delivery-slots', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, time_window, max_orders_per_slot, display_order } = req.body;
    if (!name || !time_window) {
      return res.status(400).json({ error: 'Slot name and time window are required.' });
    }

    const slot = await deliverySlotsRepo.create({
      name: name.trim(),
      time_window: time_window.trim(),
      max_orders_per_slot: Number(max_orders_per_slot) || 25,
      is_active: true,
      display_order: Number(display_order) || 1
    });

    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_CREATED', 'delivery_slots', slot.id, `Added slot ${name}`);
    res.status(201).json(slot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/delivery-slots/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, time_window, max_orders_per_slot, is_active, display_order } = req.body;

    const updated = await deliverySlotsRepo.update(id, {
      ...(name ? { name: name.trim() } : {}),
      ...(time_window ? { time_window: time_window.trim() } : {}),
      ...(max_orders_per_slot !== undefined ? { max_orders_per_slot: Number(max_orders_per_slot) } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {}),
      ...(display_order !== undefined ? { display_order: Number(display_order) } : {})
    });

    if (!updated) return res.status(404).json({ error: 'Delivery slot not found.' });
    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_UPDATED', 'delivery_slots', id, `Updated delivery slot`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/delivery-slots/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await deliverySlotsRepo.deactivate(id);
    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_DEACTIVATED', 'delivery_slots', id, `Deactivated slot`);
    res.json({ message: 'Delivery slot removed.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const product = await productsRepo.findById(id);
    if (!product || product.is_deleted || product.is_active === false) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    if (product.store_id) {
      const store = await storesRepo.findById(product.store_id);
      if (!store || store.approval_status !== 'approved' || store.is_active === false) {
        return res.status(404).json({ error: 'Product not found.' });
      }
    }
    res.json(sanitizeProductForCustomer(product));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin-Only Product Catalog (includes purchase cost, auto-computed gross margin, and supplier details)
app.get('/api/admin/products', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, search, in_stock } = req.query;
    const products = await productsRepo.list({
      category: category as string,
      search: search as string,
      in_stock: in_stock === 'true',
      includeWholesale: true
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

      const itemStoreId = product.store_id ? Number(product.store_id) : null;
      if (cartStoreId === undefined) {
        cartStoreId = itemStoreId;
      } else if (cartStoreId !== itemStoreId && !storeMixedErrorAdded) {
        errors.push('Cart items cannot mix products from different stores.');
        storeMixedErrorAdded = true;
      }

      if (itemStoreId) {
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
    res.status(500).json({ error: err.message });
  }
});

// Admin Product Management
app.post('/api/products', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      category_id,
      name,
      unit,
      price,
      mrp,
      stock,
      image_url,
      description,
      product_type,
      min_order_qty,
      max_order_qty,
      pricing_slabs,
      purchase_cost,
      supplier_id,
      supplier_name,
      supplier_phone,
      supplier_address
    } = req.body;
    if (!name || !unit || price === undefined) {
      return res.status(400).json({ error: 'Name, unit, and price are required.' });
    }

    const numPrice = Number(price);
    const numMrp = mrp ? Number(mrp) : numPrice;
    const discount = numMrp > numPrice ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;
    const numStock = Math.round((Number(stock) || 0) * 100) / 100;

    if (numStock < 0) {
      return res.status(400).json({ error: 'Stock cannot be negative.' });
    }

    if (purchase_cost !== undefined && purchase_cost !== null && purchase_cost !== '' && Number(purchase_cost) < 0) {
      return res.status(400).json({ error: 'Purchase cost cannot be negative.' });
    }

    const resolvedType = normalizeProductType(product_type, unit.trim());
    const minOrderQty =
      min_order_qty !== undefined && min_order_qty !== null && min_order_qty !== ''
        ? Number(min_order_qty)
        : 1;
    const maxOrderQty =
      max_order_qty !== undefined && max_order_qty !== null && max_order_qty !== ''
        ? Number(max_order_qty)
        : null;

    if (!Number.isFinite(minOrderQty) || minOrderQty <= 0) {
      return res.status(400).json({ error: 'Minimum order quantity must be greater than 0.' });
    }
    if (maxOrderQty !== null && (!Number.isFinite(maxOrderQty) || maxOrderQty < minOrderQty)) {
      return res.status(400).json({ error: 'Maximum order quantity must be ≥ minimum order quantity.' });
    }

    const slabCheck = validateAdminPriceSlabs(pricing_slabs, resolvedType);
    if (!slabCheck.valid) {
      return res.status(400).json({ error: slabCheck.error });
    }

    let resolvedSupplierId: number | null = supplier_id ? Number(supplier_id) : null;
    let resolvedSupplierName: string | null = supplier_name ? String(supplier_name).trim() : null;
    let resolvedSupplierPhone: string | null = supplier_phone ? String(supplier_phone).trim() : null;
    let resolvedSupplierAddress: string | null = supplier_address ? String(supplier_address).trim() : null;

    if (resolvedSupplierId) {
      const sup = await suppliersRepo.findById(resolvedSupplierId);
      if (sup) {
        if (!resolvedSupplierName) resolvedSupplierName = sup.name;
        if (!resolvedSupplierPhone) resolvedSupplierPhone = sup.phone;
        if (!resolvedSupplierAddress) resolvedSupplierAddress = sup.address;
      }
    }

    const wholesale = computeWholesaleMetrics(numPrice, purchase_cost);

    const product = await productsRepo.create({
      category_id: Number(category_id) || 1,
      name: name.trim(),
      unit: unit.trim(),
      price: numPrice,
      mrp: numMrp,
      discount_percent: discount,
      stock: numStock,
      image_url: image_url || null,
      description: description || null,
      is_active: true,
      product_type: resolvedType,
      min_order_qty: minOrderQty,
      max_order_qty: maxOrderQty,
      pricing_slabs: slabCheck.slabs,
      purchase_cost: wholesale.purchase_cost,
      gross_margin: wholesale.gross_margin,
      margin_percent: wholesale.margin_percent,
      supplier_id: resolvedSupplierId,
      supplier_name: resolvedSupplierName,
      supplier_phone: resolvedSupplierPhone,
      supplier_address: resolvedSupplierAddress,
      created_at: new Date().toISOString()
    });

    await logAudit(req.user!.id, 'admin', 'PRODUCT_CREATED', 'products', product.id, `Created product ${product.name}`);
    res.status(201).json(product);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await productsRepo.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    const {
      category_id,
      name,
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
      pricing_slabs,
      purchase_cost,
      supplier_id,
      supplier_name,
      supplier_phone,
      supplier_address
    } = req.body;

    const numPrice = price !== undefined ? Number(price) : Number(existing.price);
    const numMrp = mrp !== undefined ? Number(mrp) : Number(existing.mrp || numPrice);
    const discount = numMrp > numPrice ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;

    if (purchase_cost !== undefined && purchase_cost !== null && purchase_cost !== '' && Number(purchase_cost) < 0) {
      return res.status(400).json({ error: 'Purchase cost cannot be negative.' });
    }

    const effectiveCost = purchase_cost !== undefined ? purchase_cost : existing.purchase_cost;
    const wholesale = computeWholesaleMetrics(numPrice, effectiveCost);

    const resolvedType = product_type !== undefined
      ? normalizeProductType(product_type, unit ? unit.trim() : existing.unit)
      : normalizeProductType(existing.product_type, existing.unit);

    const minOrderQty =
      min_order_qty !== undefined
        ? (min_order_qty === null || min_order_qty === '' ? 1 : Number(min_order_qty))
        : (existing.min_order_qty || 1);
    const maxOrderQty =
      max_order_qty !== undefined
        ? (max_order_qty === null || max_order_qty === '' ? null : Number(max_order_qty))
        : (existing.max_order_qty ?? null);

    if (!Number.isFinite(minOrderQty) || minOrderQty <= 0) {
      return res.status(400).json({ error: 'Minimum order quantity must be greater than 0.' });
    }
    if (maxOrderQty !== null && (!Number.isFinite(maxOrderQty) || maxOrderQty < minOrderQty)) {
      return res.status(400).json({ error: 'Maximum order quantity must be ≥ minimum order quantity.' });
    }

    let slabsPatch: Record<string, any> = {};
    if (pricing_slabs !== undefined) {
      const slabCheck = validateAdminPriceSlabs(pricing_slabs, resolvedType);
      if (!slabCheck.valid) {
        return res.status(400).json({ error: slabCheck.error });
      }
      slabsPatch = { pricing_slabs: slabCheck.slabs };
    }

    let supPatch: Record<string, any> = {};
    if (supplier_id !== undefined || supplier_name !== undefined || supplier_phone !== undefined || supplier_address !== undefined) {
      let resolvedSupplierId: number | null = supplier_id ? Number(supplier_id) : null;
      let resolvedSupplierName: string | null = supplier_name ? String(supplier_name).trim() : null;
      let resolvedSupplierPhone: string | null = supplier_phone ? String(supplier_phone).trim() : null;
      let resolvedSupplierAddress: string | null = supplier_address ? String(supplier_address).trim() : null;

      if (resolvedSupplierId) {
        const sup = await suppliersRepo.findById(resolvedSupplierId);
        if (sup) {
          if (!resolvedSupplierName) resolvedSupplierName = sup.name;
          if (!resolvedSupplierPhone) resolvedSupplierPhone = sup.phone;
          if (!resolvedSupplierAddress) resolvedSupplierAddress = sup.address;
        }
      }
      supPatch = {
        supplier_id: resolvedSupplierId,
        supplier_name: resolvedSupplierName,
        supplier_phone: resolvedSupplierPhone,
        supplier_address: resolvedSupplierAddress
      };
    }

    const updated = await productsRepo.update(id, {
      ...(category_id !== undefined ? { category_id: Number(category_id) } : {}),
      ...(name ? { name: name.trim() } : {}),
      ...(unit ? { unit: unit.trim() } : {}),
      ...(price !== undefined ? { price: numPrice } : {}),
      ...(mrp !== undefined ? { mrp: numMrp } : {}),
      discount_percent: discount,
      ...(stock !== undefined ? { stock: Math.round(Number(stock) * 100) / 100 } : {}),
      ...(image_url !== undefined ? { image_url } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {}),
      product_type: resolvedType,
      min_order_qty: minOrderQty,
      max_order_qty: maxOrderQty,
      ...slabsPatch,
      purchase_cost: wholesale.purchase_cost,
      gross_margin: wholesale.gross_margin,
      margin_percent: wholesale.margin_percent,
      ...supPatch
    });

    if (!updated) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await logAudit(req.user!.id, 'admin', 'PRODUCT_UPDATED', 'products', id, `Updated product details & wholesale pricing`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await productsRepo.softDelete(id);
    if (!ok) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await logAudit(req.user!.id, 'admin', 'PRODUCT_DELETED', 'products', id, `Deactivated product #${id}`);
    res.json({ message: 'Product removed successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Stock Adjustment with Audit
app.put('/api/products/:id/stock', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { stock, reason } = req.body;
    const newStock = Math.round(Number(stock) * 100) / 100;

    if (!Number.isFinite(newStock) || newStock < 0) {
      return res.status(400).json({ error: 'Stock cannot be negative.' });
    }

    const updated = await productsRepo.adjustStock(id, newStock, reason, req.user!.id);
    await logAudit(req.user!.id, 'admin', 'STOCK_ADJUSTED', 'products', id, `Adjusted stock to ${newStock} (${reason || 'Manual'})`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Order Management (Business Rules & Transactions)
// ----------------------------------------------------
app.post('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

    if (payment_mode !== undefined && !['COD', 'Pay at Store'].includes(payment_mode)) {
      return res.status(400).json({ error: 'Only Cash on Delivery (COD) and Pay at Store are supported.' });
    }

    const cleanPhone = String(customer_phone || req.user!.phone || '').trim().replace(/\D/g, '');
    const recipientName = String(customer_name || req.user!.name || '').trim();
    const storeId = store_id ? Number(store_id) : null;
    const fulfillment: 'delivery' | 'pickup' = fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
    const resolvedPaymentMode: 'COD' | 'Pay at Store' =
      fulfillment === 'pickup' && payment_mode === 'Pay at Store' ? 'Pay at Store' : 'COD';

    let storeDoc: StoreDoc | null = null;
    if (storeId) {
      storeDoc = await storesRepo.findById(storeId);
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
    } else if (fulfillment === 'pickup') {
      return res.status(400).json({ error: 'Store pickup is available for local kirana store orders.' });
    }

    const address =
      fulfillment === 'pickup' && storeDoc
        ? `Store Pickup: ${storeDoc.name}, ${storeDoc.address}`
        : String(delivery_address || req.user!.address || '').trim();

    if (!recipientName || cleanPhone.length < 10 || !address || (fulfillment === 'delivery' && address.length < 5)) {
      return res.status(400).json({ error: 'Recipient name, valid 10-digit mobile number, and complete delivery address are mandatory.' });
    }

    let cLat = Number(customer_lat);
    let cLng = Number(customer_lng);
    let road: { distance_km: number; duration_mins: number | null; source: 'osrm' | 'haversine_fallback' };
    let pickupCode: string | null = null;

    if (storeDoc && fulfillment === 'pickup') {
      if (!isValidCoordinate(cLat, cLng)) {
        cLat = storeDoc.lat;
        cLng = storeDoc.lng;
      }
      road = { distance_km: 0, duration_mins: null, source: 'osrm' };
      pickupCode = generateDeliveryOTP();
    } else {
      // Require map pin coordinates & calculate road distance strictly on the backend (NEVER trust client delivery_fee)
      if (!isValidCoordinate(cLat, cLng)) {
        return res.status(400).json({ error: 'Please pin your delivery location on the map to calculate delivery distance and charges.' });
      }

      if (storeDoc) {
        road = await calculateRoadDistanceKm(storeDoc.lat, storeDoc.lng, cLat, cLng);
        if (storeDoc.delivery_radius_km > 0 && road.distance_km > storeDoc.delivery_radius_km) {
          return res.status(400).json({
            error: `Delivery unavailable beyond ${storeDoc.delivery_radius_km} km for ${storeDoc.name}. Your location is ${road.distance_km} km away.`
          });
        }
      } else {
        const settings = await settingsRepo.getDeliverySettings();
        road = await calculateRoadDistanceKm(
          settings.warehouse_lat,
          settings.warehouse_lng,
          cLat,
          cLng
        );
        const quoteCheck = calculateDeliveryFeeFromDistance(
          road.distance_km,
          road.duration_mins,
          road.source,
          settings
        );
        if (!quoteCheck.deliverable) {
          return res.status(400).json({ error: quoteCheck.reason || 'Delivery unavailable at your selected location.' });
        }
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
      if (o.delivery_address !== address || (o.store_id ?? null) !== (storeId ?? null) || (o.fulfillment_type || 'delivery') !== fulfillment) {
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
        storeId: storeDoc ? storeDoc.id : null,
        fulfillmentType: fulfillment,
        paymentMode: resolvedPaymentMode,
        idempotencyKey: idempotency_key ? String(idempotency_key) : null,
        pickupCode,
        address,
        landmark: landmark || (storeDoc ? storeDoc.landmark || storeDoc.city : 'Karanja Lad'),
        pincode: pincode || (storeDoc ? storeDoc.pincode : '444105'),
        deliveryType: delivery_type === 'scheduled' ? 'scheduled' : 'immediate',
        scheduledDate: scheduled_date || (delivery_type === 'scheduled' ? 'Today' : 'Immediate Express'),
        timeSlot: time_slot || (fulfillment === 'pickup' ? 'Store Pickup' : delivery_type === 'scheduled' ? '09:00 AM - 12:00 PM' : 'Within 45-60 mins'),
        tipAmount: fulfillment === 'pickup' ? 0 : Number(tip_amount) || 0,
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

// Get orders list (Role-filtered, enriched with items & store address/instructions)
app.get('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let orders: OrderDoc[] = [];
    if (req.user!.role === 'customer') {
      orders = await ordersRepo.list({ customer_id: req.user!.id });
    } else if (req.user!.role === 'rider') {
      orders = await ordersRepo.list({ rider_id: req.user!.id });
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

    // Filter OTP from general list for security
    const sanitized = orders.map(o => {
      const isCustomerOwner = req.user!.role === 'customer' && o.customer_id === req.user!.id;
      const st = o.store_id ? storeMap.get(o.store_id) : null;
      return {
        ...o,
        store_address: st?.address || null,
        store_delivery_info: st?.delivery_info || null,
        delivery_otp: isCustomerOwner && ['dispatched', 'delivered'].includes(o.status) ? o.delivery_otp : undefined,
        items: itemsMap.get(o.id) || []
      };
    });

    res.json(sanitized);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single order details with items
app.get('/api/orders/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { order, items } = await ordersRepo.findById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Authorization check
    if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (req.user!.role === 'rider' && order.rider_id !== req.user!.id) {
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
    const canSeeOtp = (isCustomerOwner || req.user!.role === 'admin') && ['dispatched', 'delivered'].includes(order.status);

    res.json({
      ...order,
      store_address: st?.address || null,
      store_delivery_info: st?.delivery_info || null,
      delivery_otp: canSeeOtp ? order.delivery_otp : undefined,
      items
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// Update order status (confirmed, packed)
app.put('/api/orders/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!['confirmed', 'packed'].includes(status)) {
      return res.status(400).json({ error: 'Use specific endpoints for dispatch, deliver, or cancel.' });
    }

    const order = await ordersRepo.updateStatus(id, status);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    await logAudit(req.user!.id, 'admin', 'ORDER_STATUS_UPDATE', 'orders', id, `Status updated to ${status}`);
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List riders for assignment and fleet management
app.get('/api/admin/riders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const riders = await usersRepo.listRiders();
    const allOrders = await ordersRepo.list();

    const formatted = riders.map(r => {
      const riderOrders = allOrders.filter(o => o.rider_id === r.id);
      const assigned = riderOrders.filter(o => ['placed', 'confirmed', 'packed', 'dispatched'].includes(o.status)).length;
      const active = riderOrders.filter(o => o.status === 'dispatched').length;
      const delivered = riderOrders.filter(o => o.status === 'delivered').length;
      const failed = riderOrders.filter(o => Boolean(o.failure_reason)).length;
      const unreconciledOrders = riderOrders.filter(o => o.status === 'delivered' && !o.cod_reconciled);
      const cashInHand = unreconciledOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);

      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        landmark: r.landmark,
        is_active: r.is_active,
        assigned_deliveries: assigned,
        active_deliveries: active,
        total_delivered: delivered,
        failed_deliveries: failed,
        unreconciled_orders: unreconciledOrders.length,
        cash_in_hand: cashInHand
      };
    });

    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Create Rider Account
app.post('/api/admin/riders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, phone, password, email, address, landmark } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'Rider name, mobile number, and initial password are required.' });
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    const existing = await usersRepo.findByPhoneAndRole(cleanPhone, 'rider');
    if (existing) {
      return res.status(400).json({ error: 'A delivery rider with this mobile number already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rider = await usersRepo.create({
      phone: cleanPhone,
      name: name.trim(),
      email: email?.trim() || null,
      role: 'rider',
      password_hash: passwordHash,
      address: address?.trim() || 'Karanja Lad',
      landmark: landmark?.trim() || null,
      city: 'Karanja Lad',
      pincode: '444105',
      is_active: true,
      created_at: new Date().toISOString()
    });

    await logAudit(req.user!.id, 'admin', 'RIDER_CREATED', 'users', rider.id, `Created delivery partner account for ${rider.name} (${cleanPhone})`);

    // Welcome notification for rider
    await notificationsRepo.create({
      user_id: rider.id,
      title: 'Welcome to FMP Supermart Fleet! 🛵',
      message: `Welcome ${rider.name}! Your delivery partner account is active. Admin will assign delivery orders to you.`,
      type: 'account'
    });

    res.status(201).json({ message: 'Delivery partner account created successfully.', rider });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Update Rider Details / Toggle Active
app.put('/api/admin/riders/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, phone, email, address, landmark, is_active } = req.body;

    const rider = await usersRepo.findById(id);
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({ error: 'Delivery rider not found.' });
    }

    const updated = await usersRepo.update(id, {
      ...(name ? { name: name.trim() } : {}),
      ...(phone ? { phone: phone.trim().replace(/\D/g, '') } : {}),
      ...(email !== undefined ? { email: email?.trim() || null } : {}),
      ...(address !== undefined ? { address: address?.trim() || null } : {}),
      ...(landmark !== undefined ? { landmark: landmark?.trim() || null } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {})
    });

    await logAudit(req.user!.id, 'admin', 'RIDER_UPDATED', 'users', id, `Updated delivery partner profile for ${updated?.name}`);
    res.json({ message: 'Rider details updated.', rider: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reset Rider Password
app.put('/api/admin/riders/:id/reset-password', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const rider = await usersRepo.findById(id);
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({ error: 'Delivery rider not found.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await usersRepo.update(id, { password_hash: passwordHash });

    await logAudit(req.user!.id, 'admin', 'RIDER_PASSWORD_RESET', 'users', id, `Reset password for rider ${rider.name}`);
    res.json({ message: `Password successfully reset for ${rider.name}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign or Reassign rider to order
app.post('/api/orders/:id/assign-rider', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rider_id } = req.body;

    const rider = await usersRepo.findById(Number(rider_id));
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({ error: 'Delivery rider not found.' });
    }
    if (rider.is_active === false) {
      return res.status(400).json({ error: 'Cannot assign order to an inactive delivery partner. Please activate their account first.' });
    }

    const { order } = await ordersRepo.findById(id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.rider_id === rider.id) {
      return res.json({ message: `Order #${order.order_number} is already assigned to ${rider.name}.`, order });
    }

    const isReassignment = Boolean(order.rider_id);
    const oldRiderName = order.rider_name || 'Unassigned';

    const updated = await ordersRepo.assignRider(id, rider);

    const auditAction = isReassignment ? 'RIDER_REASSIGNED' : 'RIDER_ASSIGNED';
    const auditText = isReassignment
      ? `Reassigned order #${order.order_number} from ${oldRiderName} to ${rider.name}`
      : `Assigned rider ${rider.name} to order #${order.order_number}`;

    await logAudit(req.user!.id, 'admin', auditAction, 'orders', id, auditText);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Set/Update delivery fee for an individual order
app.put('/api/orders/:id/delivery-fee', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { delivery_fee } = req.body;

    if (delivery_fee === undefined || isNaN(Number(delivery_fee)) || Number(delivery_fee) < 0) {
      return res.status(400).json({ error: 'Please specify a valid delivery fee (₹0 or greater).' });
    }

    const newFee = Number(delivery_fee);
    const updated = await ordersRepo.updateDeliveryFee(id, newFee);

    await logAudit(
      req.user!.id,
      'admin',
      'ORDER_DELIVERY_FEE_UPDATED',
      'orders',
      id,
      `Adjusted delivery fee to ₹${newFee}. Total COD payable updated to ₹${updated?.total_amount}.`
    );

    res.json({ message: `Delivery fee updated to ₹${newFee}. Total payable: ₹${updated?.total_amount}.`, order: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dispatch order: Generates secure customer-only Delivery OTP
app.post('/api/orders/:id/dispatch', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { order } = await ordersRepo.findById(id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (!order.rider_id) {
      return res.status(400).json({ error: 'Please assign a delivery rider before dispatching the order.' });
    }

    const deliveryOtp = generateDeliveryOTP();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const dispatchedOrder = await ordersRepo.dispatch(id, deliveryOtp, expiresAt);

    await logAudit(req.user!.id, 'admin', 'ORDER_DISPATCHED', 'orders', id, `Order dispatched with secure OTP generated`);

    res.json({
      message: 'Order dispatched successfully. Secure delivery OTP generated for customer.',
      order: dispatchedOrder
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Dashboard Analytics & Statistics
app.get('/api/admin/stats', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = await ordersRepo.list();
    const products = await productsRepo.list();

    const placedCount = orders.filter(o => o.status === 'placed').length;
    const confirmedCount = orders.filter(o => o.status === 'confirmed').length;
    const packedCount = orders.filter(o => o.status === 'packed').length;
    const dispatchedCount = orders.filter(o => o.status === 'dispatched').length;
    const deliveredCount = orders.filter(o => o.status === 'delivered').length;
    const cancelledCount = orders.filter(o => o.status === 'cancelled').length;

    const deliveredOrders = orders.filter(o => o.status === 'delivered');
    const totalRevenue = deliveredOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const unreconciledCash = orders
      .filter(o => o.cod_collected === true && !o.cod_reconciled)
      .reduce((sum, o) => sum + Number(o.total_amount), 0);

    const activeProducts = products.filter(p => p.is_active !== false);
    const outOfStock = activeProducts.filter(p => p.stock === 0).length;
    const lowStock = activeProducts.filter(p => p.stock > 0 && p.stock <= 10).length;
    const totalUnits = activeProducts.reduce((sum, p) => sum + Number(p.stock), 0);

    const lowStockItems = activeProducts
      .filter(p => p.stock <= 10)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10);

    const recentOrders = orders.slice(0, 8);

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
        unreconciled_cash: unreconciledCash
      },
      inventory: {
        total_products: activeProducts.length,
        out_of_stock: outOfStock,
        low_stock: lowStock,
        total_units_in_stock: totalUnits
      },
      lowStockItems,
      recentOrders
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    const products = await productsRepo.list();
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
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 25);

    res.json({
      categorySales,
      inventoryLogs
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Logs
app.get('/api/admin/audit-logs', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await auditLogsRepo.list(50);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Suppliers & Purchase Orders
// ----------------------------------------------------
app.get('/api/suppliers', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await suppliersRepo.list();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, contact_person, phone, email, address, gst_number } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Supplier name and phone are required.' });

    const sup = await suppliersRepo.create({
      name: name.trim(),
      contact_person: contact_person ? contact_person.trim() : '',
      phone: phone.trim(),
      email: email?.trim() || null,
      address: address ? address.trim() : 'Karanja Lad',
      city: 'Karanja Lad',
      gst_number: gst_number || ''
    });

    await logAudit(req.user!.id, 'admin', 'SUPPLIER_CREATED', 'suppliers', sup.id, `Added supplier ${name}`);
    res.status(201).json(sup);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchase-orders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await purchaseOrdersRepo.list();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-orders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { supplier_id, items, notes } = req.body;
    if (!supplier_id || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Supplier and items are required.' });
    }

    const po = await purchaseOrdersRepo.create(Number(supplier_id), items, notes);
    await logAudit(req.user!.id, 'admin', 'PURCHASE_ORDER_CREATED', 'purchase_orders', po.id, `Created PO ${po.po_number}`);
    res.status(201).json(po);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-orders/:id/receive', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const receivedPO = await purchaseOrdersRepo.receive(id);
    await logAudit(req.user!.id, 'admin', 'PURCHASE_ORDER_RECEIVED', 'purchase_orders', id, `Received PO ${receivedPO.po_number}`);
    res.json({ message: 'Purchase order received and inventory updated.', po: receivedPO });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Delivery Boy / Rider Operations
// ----------------------------------------------------
app.get('/api/rider/assigned-orders', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = await ordersRepo.list({ rider_id: req.user!.id });

    // Riders do NOT receive delivery_otp in their payload!
    const sanitized = orders
      .map(o => ({
        ...o,
        delivery_otp: undefined
      }))
      .sort((a, b) => {
        const priority: Record<string, number> = { dispatched: 1, confirmed: 2, packed: 3, placed: 4, delivered: 5, cancelled: 6 };
        return (priority[a.status] || 99) - (priority[b.status] || 99);
      });

    res.json(sanitized);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rider OTP Verification & Delivery Completion
app.post('/api/rider/orders/:id/verify-otp-deliver', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { otp } = req.body;

    if (!otp || !otp.toString().trim()) {
      return res.status(400).json({ error: 'Please enter the 4-digit Delivery OTP provided by the customer.' });
    }

    const inputOtp = otp.toString().trim();
    const adminUsers = await usersRepo.listAdmins();

    const delivered = await ordersRepo.verifyOtpAndDeliverTransactional(
      id,
      inputOtp,
      req.user as any,
      adminUsers
    );

    await logAudit(
      req.user!.id,
      req.user!.role,
      'ORDER_DELIVERED_OTP_VERIFIED',
      'orders',
      id,
      `Order #${delivered.order_number} marked DELIVERED after valid OTP verification. Collected ₹${delivered.total_amount} COD.`
    );

    res.json({
      message: 'Delivery OTP verified successfully! Order marked as DELIVERED.',
      order: delivered
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/rider/orders/:id/report-failed', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Failure reason is required (e.g. Customer door locked, Customer unreachable).' });
    }

    const updated = await ordersRepo.reportDeliveryFailure(id, reason.trim());
    if (!updated) return res.status(404).json({ error: 'Order not found.' });

    await logAudit(req.user!.id, 'rider', 'DELIVERY_FAILED_REPORT', 'orders', id, `Reported failure: ${reason}`);
    res.json({ message: 'Delivery attempt issue recorded.', order: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rider/cod-summary', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const riderId = req.user!.id;
    const orders = await ordersRepo.list({ rider_id: riderId });

    const collectedOrders = orders.filter(o => o.cod_collected === true);
    const totalCash = collectedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const totalTips = collectedOrders.reduce((sum, o) => sum + Number(o.tip_amount || 0), 0);

    const pendingReconcile = collectedOrders.filter(o => !o.cod_reconciled);
    const cashInHand = pendingReconcile.reduce((sum, o) => sum + Number(o.total_amount), 0);

    const reconciledOrders = collectedOrders.filter(o => o.cod_reconciled === true);
    const reconciledAmount = reconciledOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);

    res.json({
      summary: {
        total_collected_orders: collectedOrders.length,
        total_cash_collected: totalCash,
        total_tips_collected: totalTips,
        pending_reconcile_orders: pendingReconcile.length,
        cash_in_hand: cashInHand,
        reconciled_orders: reconciledOrders.length,
        reconciled_amount: reconciledAmount
      },
      pendingOrders: pendingReconcile
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// COD Reconciliation (Admin)
// ----------------------------------------------------
app.get('/api/admin/cod-pending', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await codReconciliationsRepo.getPendingPerRider();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/cod-reconcile', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rider_id, notes } = req.body;
    if (!rider_id) return res.status(400).json({ error: 'Rider ID is required.' });

    const result = await codReconciliationsRepo.reconcileRider(Number(rider_id), req.user!.id, notes);
    await logAudit(req.user!.id, 'admin', 'COD_RECONCILED', 'cod_reconciliations', result.id, `Reconciled ₹${result.total_amount} from rider ${result.rider_name}`);
    res.json({ message: 'COD cash successfully reconciled.', reconciliation: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Notifications
app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await notificationsRepo.listForUser(req.user!.id);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await notificationsRepo.markRead(id, req.user!.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/mark-all-read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await notificationsRepo.markAllRead(req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/reviews', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await reviewsRepo.listAll();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    await reviewsRepo.deleteReview(id);
    await logAudit(req.user!.id, 'admin', 'REVIEW_DELETED', 'reviews', id, 'Deleted review');
    res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Hyperlocal Grocery Marketplace: Store Self-Registration & Public Discovery
// ----------------------------------------------------
app.post('/api/stores/register', async (req: Request, res: Response) => {
  try {
    const {
      owner_name,
      phone,
      password,
      store_name,
      description,
      address,
      landmark,
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
      email: null,
      role: 'store_owner',
      store_id: null,
      password_hash: passwordHash,
      address: address.trim(),
      landmark: landmark?.trim() || null,
      city: 'Karanja Lad',
      pincode: pincode?.trim() || '444105',
      is_active: true,
      created_at: nowIso
    });

    const store = await storesRepo.create({
      owner_id: ownerUser.id,
      owner_name: owner_name.trim(),
      owner_phone: cleanPhone,
      name: store_name.trim(),
      description: description?.trim() || null,
      address: address.trim(),
      landmark: landmark?.trim() || null,
      city: 'Karanja Lad',
      pincode: pincode?.trim() || '444105',
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
        message: `${store.name} (${owner_name.trim()}, ${cleanPhone}) has registered and awaits your approval.`,
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
      pincode: ownerUser.pincode
    };

    const token = generateToken(userPayload as any);
    await logAudit(ownerUser.id, 'store_owner', 'STORE_REGISTERED', 'stores', store.id, `Registered store ${store.name} (pending admin approval)`);

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

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

// Customer Store Discovery: ONLY returns real Admin-approved active stores with valid location sorted by distance
app.get('/api/stores/nearby', async (req: Request, res: Response) => {
  try {
    const qLat = Number(req.query.lat);
    const qLng = Number(req.query.lng);
    const search = String(req.query.search || '').trim().toLowerCase();

    const refLat = isValidCoordinate(qLat, qLng) ? qLat : DEFAULT_WAREHOUSE_LAT;
    const refLng = isValidCoordinate(qLat, qLng) ? qLng : DEFAULT_WAREHOUSE_LNG;

    const approvedStores = (await storesRepo.listApprovedActive()).filter(
      st => isValidCoordinate(st.lat, st.lng) && Boolean(st.address && st.address.trim())
    );
    const allProducts = await productsRepo.list({ includeWholesale: false });

    const productCountMap: Record<number, number> = {};
    const availableProductNamesMap: Record<number, string[]> = {};
    for (const p of allProducts) {
      if (p.store_id) {
        productCountMap[p.store_id] = (productCountMap[p.store_id] || 0) + 1;
        if (p.is_active !== false && !p.is_deleted && Number(p.stock) > 0 && p.name) {
          if (!availableProductNamesMap[p.store_id]) {
            availableProductNamesMap[p.store_id] = [];
          }
          availableProductNamesMap[p.store_id].push(p.name);
        }
      }
    }

    let enriched = approvedStores.map(st => {
      const distKm = Math.round(calculateHaversineKm(refLat, refLng, st.lat, st.lng) * 100) / 100;
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
          (st.description && st.description.toLowerCase().includes(search)) ||
          (Array.isArray(st.available_product_names) &&
            st.available_product_names.some(prodName => prodName.toLowerCase().includes(search)))
      );
    }

    enriched.sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0));
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const refLat = isValidCoordinate(qLat, qLng) ? qLat : DEFAULT_WAREHOUSE_LAT;
    const refLng = isValidCoordinate(qLat, qLng) ? qLng : DEFAULT_WAREHOUSE_LNG;
    const distKm = Math.round(calculateHaversineKm(refLat, refLng, store.lat, store.lng) * 100) / 100;
    const storeProds = await productsRepo.list({ store_id: id, includeWholesale: false });

    res.json(
      sanitizePublicStore(store, {
        distance_km: distKm,
        product_count: storeProds.length
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      owner_phone,
      address,
      landmark,
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
      owner_phone: cleanOwnerPhone,
      ...(address !== undefined && String(address).trim() ? { address: String(address).trim() } : {}),
      ...(landmark !== undefined ? { landmark: landmark ? String(landmark).trim() : null } : {}),
      ...(pincode !== undefined && String(pincode).trim() ? { pincode: String(pincode).trim() } : {}),
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
    res.status(500).json({ error: err.message });
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

    await productsRepo.softDelete(id);
    await logAudit(req.user!.id, 'store_owner', 'STORE_PRODUCT_DELETED', 'products', id, `Store ${store.name} removed product #${id}`);
    res.json({ message: 'Product deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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

    const { status, rejection_reason } = req.body;
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
      return res.json(cancelled);
    }

    const extra =
      status === 'delivered'
        ? { payment_status: 'paid' as const, cod_collected: true, cod_collected_at: new Date().toISOString() }
        : undefined;

    const updated = await ordersRepo.updateStatus(id, status, extra);
    await logAudit(req.user!.id, 'store_owner', 'STORE_ORDER_STATUS', 'orders', id, `Store ${store.name} marked order #${order.order_number} as ${status}`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Complaints / Reported Problems (Customers & Store Owners -> Admin)
// ----------------------------------------------------
app.post('/api/complaints', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subject, description, store_id, order_id } = req.body;
    if (!subject?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'Subject and problem description are required.' });
    }

    let storeName: string | null = null;
    if (store_id) {
      const st = await storesRepo.findById(Number(store_id));
      storeName = st?.name || null;
    }

    let orderNumber: string | null = null;
    if (order_id) {
      const { order } = await ordersRepo.findById(Number(order_id));
      orderNumber = order?.order_number || null;
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
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Admin Marketplace Control Routes (Stores, Customers, Categories, Complaints)
// ----------------------------------------------------
app.get('/api/admin/stores', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stores = await storesRepo.listAll();
    const products = await productsRepo.list({ includeInactive: true, includeWholesale: true });
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
    res.status(500).json({ error: err.message });
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
        ...safeUser,
        order_count: statsByCustomer[safeUser.id]?.orders || 0,
        total_spent: Math.round((statsByCustomer[safeUser.id]?.total_spent || 0) * 100) / 100
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    const { password_hash: _pw, ...safe } = updated;
    await logAudit(req.user!.id, 'admin', 'CUSTOMER_STATUS_UPDATED', 'users', id, `Customer ${customer.name} is_active=${Boolean(is_active)}`);
    res.json(safe);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/categories', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await categoriesRepo.list(true);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    await logAudit(req.user!.id, 'admin', 'CATEGORY_UPDATED', 'categories', id, `Updated category ${updated.name}`);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/categories/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await categoriesRepo.remove(id);
    if (!ok) return res.status(404).json({ error: 'Category not found.' });
    await logAudit(req.user!.id, 'admin', 'CATEGORY_DELETED', 'categories', id, `Deleted category #${id}`);
    res.json({ message: 'Category deleted.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/complaints', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const list = await complaintsRepo.listAll();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/complaints/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, admin_notes } = req.body;
    if (!['open', 'in_review', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid complaint status.' });
    }
    const updated = await complaintsRepo.update(id, {
      status,
      ...(admin_notes !== undefined ? { admin_notes: String(admin_notes).trim() } : {}),
      resolved_at: status === 'resolved' ? new Date().toISOString() : null
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
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 FMP Supermart server running on port ${PORT} (${isProduction ? 'Production' : 'Development'})`);
    console.log(`📍 Serving Karanja Lad, Maharashtra 444105 with Cloud Firestore`);
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

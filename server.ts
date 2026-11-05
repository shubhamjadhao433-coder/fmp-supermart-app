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
  UserDoc,
  OrderDoc
} from './src/server/firestoreDb.ts';
import {
  requireAuth,
  requireRole,
  generateToken,
  logAudit,
  generateDeliveryOTP,
  AuthenticatedRequest
} from './src/server/auth.ts';
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
app.use(express.json());

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
        deliveryFeeModel: 'Admin Controlled (Default ₹25, Configurable per order/area, ₹0 allowed)',
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
      min_order_amount: Number(settings.min_order_amount || 0)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/settings/delivery', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { default_delivery_fee, handling_fee, min_order_amount, delivery_areas } = req.body;

    const defFee = Number(default_delivery_fee);
    const handFee = handling_fee !== undefined ? Number(handling_fee) : 5;
    const minOrder = Number(min_order_amount || 0);
    const areasStr = typeof delivery_areas === 'object' ? JSON.stringify(delivery_areas) : (delivery_areas || '[]');

    const updated = await settingsRepo.updateDeliverySettings({
      default_delivery_fee: defFee,
      handling_fee: handFee,
      min_order_amount: minOrder,
      delivery_areas: areasStr
    });

    await logAudit(req.user!.id, 'admin', 'DELIVERY_SETTINGS_UPDATED', 'delivery_settings', 1, `Updated delivery fee to ₹${defFee}, handling to ₹${handFee}`);
    res.json({ message: 'Delivery settings updated successfully.', settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category, search, in_stock } = req.query;
    const products = await productsRepo.list({
      category: category as string,
      search: search as string,
      in_stock: in_stock === 'true'
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
    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(product);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Product Management
app.post('/api/products', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category_id, name, unit, price, mrp, stock, image_url, description } = req.body;
    if (!name || !unit || price === undefined) {
      return res.status(400).json({ error: 'Name, unit, and price are required.' });
    }

    const numPrice = Number(price);
    const numMrp = mrp ? Number(mrp) : numPrice;
    const discount = numMrp > numPrice ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;
    const numStock = Number(stock) || 0;

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
    const { category_id, name, unit, price, mrp, stock, image_url, description, is_active } = req.body;

    const numPrice = Number(price);
    const numMrp = mrp ? Number(mrp) : numPrice;
    const discount = numMrp > numPrice ? Math.round(((numMrp - numPrice) / numMrp) * 100) : 0;

    const updated = await productsRepo.update(id, {
      ...(category_id !== undefined ? { category_id: Number(category_id) } : {}),
      ...(name ? { name: name.trim() } : {}),
      ...(unit ? { unit: unit.trim() } : {}),
      ...(price !== undefined ? { price: numPrice } : {}),
      ...(mrp !== undefined ? { mrp: numMrp } : {}),
      discount_percent: discount,
      ...(stock !== undefined ? { stock: Number(stock) } : {}),
      ...(image_url !== undefined ? { image_url } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(is_active !== undefined ? { is_active: Boolean(is_active) } : {})
    });

    if (!updated) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await logAudit(req.user!.id, 'admin', 'PRODUCT_UPDATED', 'products', id, `Updated product details`);
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
    const newStock = parseInt(stock, 10);

    if (isNaN(newStock) || newStock < 0) {
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
    const { items, customer_name, customer_phone, delivery_address, landmark, pincode, delivery_fee, tip_amount, delivery_type, scheduled_date, time_slot } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Please add items to checkout.' });
    }

    const cleanPhone = (customer_phone || req.user!.phone).trim().replace(/\D/g, '');
    const recipientName = (customer_name || req.user!.name).trim();
    const address = (delivery_address || req.user!.address || '').trim();

    if (!recipientName || !cleanPhone || !address) {
      return res.status(400).json({ error: 'Recipient name, mobile number, and delivery address are mandatory.' });
    }

    // Duplicate order prevention: check if customer placed an identical order within the last 5 seconds
    const recentOrders = await ordersRepo.list({ customer_id: req.user!.id });
    const now = Date.now();
    const isDuplicate = recentOrders.some(o => {
      const orderAgeMs = now - new Date(o.created_at).getTime();
      return orderAgeMs >= 0 && orderAgeMs < 5000 && o.delivery_address === address;
    });
    if (isDuplicate) {
      return res.status(409).json({ error: 'Duplicate order detected. You have already placed an order a moment ago.' });
    }

    const adminUsers = await usersRepo.listAdmins();

    const created = await ordersRepo.createTransactional(
      {
        customerId: req.user!.id,
        customerName: recipientName,
        customerPhone: cleanPhone,
        address,
        landmark: landmark || 'Karanja Lad',
        pincode: pincode || '444105',
        deliveryType: delivery_type === 'scheduled' ? 'scheduled' : 'immediate',
        scheduledDate: scheduled_date || (delivery_type === 'scheduled' ? 'Today' : 'Immediate Express'),
        timeSlot: time_slot || (delivery_type === 'scheduled' ? '09:00 AM - 12:00 PM' : 'Within 45-60 mins'),
        tipAmount: Number(tip_amount) || 0,
        deliveryFeeOverride: typeof delivery_fee === 'number' ? delivery_fee : undefined
      },
      items,
      adminUsers
    );

    await logAudit(req.user!.id, req.user!.role, 'ORDER_PLACED', 'orders', created.order.id, `Order ${created.order.order_number} placed for ₹${created.order.total_amount}`);

    res.status(201).json({
      message: 'Order placed successfully!',
      order: {
        ...created.order,
        items: created.items
      }
    });
  } catch (err: any) {
    console.error('Order placement error:', err);
    res.status(400).json({ error: err.message || 'Failed to place order.' });
  }
});

// Get orders list (Role-filtered)
app.get('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let orders: OrderDoc[] = [];
    if (req.user!.role === 'customer') {
      orders = await ordersRepo.list({ customer_id: req.user!.id });
    } else if (req.user!.role === 'rider') {
      orders = await ordersRepo.list({ rider_id: req.user!.id });
    } else {
      orders = await ordersRepo.list();
    }

    // Filter OTP from general list for security
    const sanitized = orders.map(o => {
      const isCustomerOwner = req.user!.role === 'customer' && o.customer_id === req.user!.id;
      return {
        ...o,
        delivery_otp: isCustomerOwner && ['dispatched', 'delivered'].includes(o.status) ? o.delivery_otp : undefined
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

    const isCustomerOwner = req.user!.role === 'customer' && order.customer_id === req.user!.id;
    const canSeeOtp = (isCustomerOwner || req.user!.role === 'admin') && ['dispatched', 'delivered'].includes(order.status);

    res.json({
      ...order,
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

    const { order } = await ordersRepo.findById(id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'You cannot cancel another customer’s order.' });
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

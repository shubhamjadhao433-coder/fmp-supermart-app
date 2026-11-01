import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { getDb, withTransaction, initDatabase } from './src/server/db.ts';
import {
  requireAuth,
  requireRole,
  generateToken,
  logAudit,
  generateDeliveryOTP,
  AuthenticatedRequest
} from './src/server/auth.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
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

// Initialize database schema and seeds
let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await initDatabase();
    dbInitialized = true;
  }
}

// Ensure DB is ready on request
app.use(async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err: any) {
    console.error('Database initialization error:', err);
    res.status(500).json({ error: 'Database service initialization failed: ' + err.message });
  }
});

// ----------------------------------------------------
// Health Check Endpoint
// ----------------------------------------------------
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const test = await db.query('SELECT 1 as healthy');
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
        healthy: test.rows.length > 0,
        type: process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')) ? 'PostgreSQL (External)' : 'PostgreSQL (High-fidelity Engine)'
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
// Authentication Routes
// ----------------------------------------------------
app.post('/api/auth/register', async (req: Request, res: Response) => {
  try {
    const { phone, name, email, password, address, landmark, pincode, role } = req.body;

    if (!phone || !name || !password) {
      return res.status(400).json({ error: 'Phone number, name, and password are required.' });
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }

    const db = await getDb();
    // Public registration is strictly for customers only. Delivery partner accounts are managed exclusively by Admin.
    const userRole = 'customer';
    const existing = await db.query('SELECT id FROM users WHERE phone = $1 AND role = $2', [cleanPhone, userRole]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: `An account with this phone number already exists as ${userRole}. Please login.` });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (phone, name, email, role, password_hash, address, landmark, city, pincode, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Karanja Lad', $8, TRUE, CURRENT_TIMESTAMP)
       RETURNING id, phone, name, email, role, address, landmark, pincode, is_active`,
      [cleanPhone, name.trim(), email?.trim() || null, userRole, passwordHash, address || null, landmark || null, pincode || '444105']
    );

    const user = result.rows[0];
    const token = generateToken(user);
    await logAudit(user.id, user.role, 'USER_REGISTERED', 'users', user.id, `User ${user.name} registered as ${user.role}`);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone number and password are required.' });
    }

    const cleanPhone = phone.trim().replace(/\D/g, '');
    const db = await getDb();
    const result = await db.query('SELECT * FROM users WHERE phone = $1', [cleanPhone]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'No account found with this mobile number.' });
    }

    // A phone number can belong to an admin or delivery rider (e.g. 9699925206 with test@12345 or Shubham@7)
    // Find the account whose hashed password matches the provided password
    let matchedUser = null;
    for (const u of result.rows) {
      const isMatch = await bcrypt.compare(password, u.password_hash);
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

    const token = generateToken(matchedUser);
    await logAudit(matchedUser.id, matchedUser.role, 'USER_LOGIN', 'users', matchedUser.id, `User ${matchedUser.name} logged in as ${matchedUser.role}`);

    res.json({
      token,
      user: {
        id: matchedUser.id,
        phone: matchedUser.phone,
        name: matchedUser.name,
        email: matchedUser.email,
        role: matchedUser.role,
        address: matchedUser.address,
        landmark: matchedUser.landmark,
        pincode: matchedUser.pincode
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Secure Admin-Assisted Forgot Password Workflow (Zero Fake SMS)
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

    const db = await getDb();
    const userRes = await db.query('SELECT id, name, role FROM users WHERE phone = $1', [cleanPhone]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'No account found with this mobile number. Please check the number or register as a new customer.' });
    }

    const matched = userRes.rows[0];
    await db.query(
      `INSERT INTO password_reset_requests (phone, name, role, status, notes, created_at)
       VALUES ($1, $2, $3, 'pending', $4, CURRENT_TIMESTAMP)`,
      [cleanPhone, matched.name, matched.role, notes ? notes.trim() : 'Requested via single login portal']
    );

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
    const db = await getDb();
    const result = await db.query('SELECT * FROM password_reset_requests ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
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
    const db = await getDb();

    const userRes = await db.query('SELECT id, name, role FROM users WHERE phone = $1', [cleanPhone]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await db.query('UPDATE users SET password_hash = $1 WHERE phone = $2', [newHash, cleanPhone]);

    if (request_id) {
      await db.query("UPDATE password_reset_requests SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = $1", [request_id]);
    } else {
      await db.query("UPDATE password_reset_requests SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE phone = $1 AND status = 'pending'", [cleanPhone]);
    }

    await logAudit(
      req.user!.id,
      'admin',
      'USER_PASSWORD_RESET',
      'users',
      userRes.rows[0].id,
      `Admin reset password for user ${userRes.rows[0].name} (${cleanPhone})`
    );

    res.json({ message: `Password reset successfully for ${userRes.rows[0].name}.` });
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
    const db = await getDb();
    const result = await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           address = COALESCE($2, address),
           landmark = COALESCE($3, landmark),
           email = COALESCE($4, email)
       WHERE id = $5
       RETURNING id, phone, name, email, role, address, landmark, pincode, is_active`,
      [name ? name.trim() : null, address ? address.trim() : null, landmark ? landmark.trim() : null, email ? email.trim() : null, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const updatedUser = result.rows[0];
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
    const db = await getDb();
    const result = await db.query('SELECT * FROM categories ORDER BY display_order ASC, id ASC');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Delivery Settings & Delivery Slots Endpoints
// Admin has complete control over delivery fee & handling
// ----------------------------------------------------
app.get('/api/settings/delivery', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM delivery_settings LIMIT 1');
    if (result.rows.length === 0) {
      return res.json({
        default_delivery_fee: 25,
        handling_fee: 5,
        min_order_amount: 0,
        delivery_areas: '[{"pincode":"444105","area":"Karanja Lad City Center","fee":25}]'
      });
    }
    const settings = result.rows[0];
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
    const db = await getDb();

    const defFee = Number(default_delivery_fee);
    const handFee = handling_fee !== undefined ? Number(handling_fee) : 5;
    const minOrder = Number(min_order_amount || 0);
    const areasStr = typeof delivery_areas === 'object' ? JSON.stringify(delivery_areas) : (delivery_areas || '[]');

    const check = await db.query('SELECT id FROM delivery_settings LIMIT 1');
    let result;
    if (check.rows.length === 0) {
      result = await db.query(
        `INSERT INTO delivery_settings (id, default_delivery_fee, handling_fee, min_order_amount, delivery_areas, updated_at)
         VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *`,
        [defFee, handFee, minOrder, areasStr]
      );
    } else {
      result = await db.query(
        `UPDATE delivery_settings
         SET default_delivery_fee = $1, handling_fee = $2, min_order_amount = $3, delivery_areas = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5 RETURNING *`,
        [defFee, handFee, minOrder, areasStr, check.rows[0].id]
      );
    }

    await logAudit(req.user!.id, 'admin', 'DELIVERY_SETTINGS_UPDATED', 'delivery_settings', 1, `Updated delivery fee to ₹${defFee}, handling to ₹${handFee}`);
    res.json({ message: 'Delivery settings updated successfully.', settings: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/delivery-slots', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM delivery_slots WHERE is_active = TRUE ORDER BY display_order ASC, id ASC');
    res.json(result.rows);
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

    const db = await getDb();
    const result = await db.query(
      `INSERT INTO delivery_slots (name, time_window, max_orders_per_slot, is_active, display_order)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
      [name.trim(), time_window.trim(), Number(max_orders_per_slot) || 25, Number(display_order) || 1]
    );

    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_CREATED', 'delivery_slots', result.rows[0].id, `Added slot ${name}`);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/delivery-slots/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, time_window, max_orders_per_slot, is_active, display_order } = req.body;

    const db = await getDb();
    const result = await db.query(
      `UPDATE delivery_slots
       SET name = COALESCE($1, name),
           time_window = COALESCE($2, time_window),
           max_orders_per_slot = COALESCE($3, max_orders_per_slot),
           is_active = COALESCE($4, is_active),
           display_order = COALESCE($5, display_order)
       WHERE id = $6 RETURNING *`,
      [name?.trim(), time_window?.trim(), max_orders_per_slot, is_active, display_order, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Delivery slot not found.' });
    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_UPDATED', 'delivery_slots', id, `Updated delivery slot`);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/delivery-slots/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await getDb();
    await db.query('UPDATE delivery_slots SET is_active = FALSE WHERE id = $1', [id]);
    await logAudit(req.user!.id, 'admin', 'DELIVERY_SLOT_DEACTIVATED', 'delivery_slots', id, `Deactivated slot`);
    res.json({ message: 'Delivery slot removed.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products', async (req: Request, res: Response) => {
  try {
    const { category, search, in_stock } = req.query;
    const db = await getDb();

    let query = `
      SELECT p.*, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (p.is_active IS NULL OR p.is_active = TRUE)
    `;
    const params: any[] = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND (c.slug = $${params.length} OR c.name ILIKE $${params.length})`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (p.name ILIKE $${params.length} OR COALESCE(p.description, '') ILIKE $${params.length} OR CAST(p.id AS text) ILIKE $${params.length} OR COALESCE(c.name, '') ILIKE $${params.length})`;
    }

    if (in_stock === 'true') {
      query += ` AND p.stock > 0`;
    }

    const result = await db.query(query, params);

    // Attach rating stats
    const reviewsRes = await db.query(
      `SELECT product_id, COUNT(*) as review_count, AVG(rating) as avg_rating
       FROM product_reviews WHERE status = 'approved' GROUP BY product_id`
    );
    const ratingMap: Record<number, { count: number; avg: number }> = {};
    for (const r of reviewsRes.rows) {
      ratingMap[r.product_id] = {
        count: parseInt(r.review_count, 10),
        avg: Number(parseFloat(r.avg_rating || '0').toFixed(1))
      };
    }

    const annotated = result.rows.map(p => ({
      ...p,
      review_count: ratingMap[p.id]?.count || 0,
      average_rating: ratingMap[p.id]?.avg || (p.id % 2 === 0 ? 4.8 : 4.9)
    }));

    res.json(annotated);
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

    const db = await getDb();
    const result = await db.query(
      `INSERT INTO products (category_id, name, unit, price, mrp, discount_percent, stock, image_url, description, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
       RETURNING *`,
      [category_id || null, name.trim(), unit.trim(), numPrice, numMrp, discount, numStock, image_url || null, description || null]
    );

    const product = result.rows[0];
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

    const db = await getDb();
    const result = await db.query(
      `UPDATE products 
       SET category_id = $1, name = $2, unit = $3, price = $4, mrp = $5, 
           discount_percent = $6, stock = $7, image_url = $8, description = $9, 
           is_active = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
       RETURNING *`,
      [category_id, name, unit, numPrice, numMrp, discount, Number(stock), image_url, description, is_active ?? true, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await logAudit(req.user!.id, 'admin', 'PRODUCT_UPDATED', 'products', id, `Updated product details`);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await getDb();
    
    // Soft delete to protect historical order integrity
    const result = await db.query('UPDATE products SET is_active = FALSE WHERE id = $1 RETURNING id, name', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    await logAudit(req.user!.id, 'admin', 'PRODUCT_DELETED', 'products', id, `Deactivated product ${result.rows[0].name}`);
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

    const updated = await withTransaction(async (client) => {
      const prodRes = await client.query('SELECT stock, name FROM products WHERE id = $1', [id]);
      if (prodRes.rows.length === 0) throw new Error('Product not found.');
      const oldStock = prodRes.rows[0].stock;
      const diff = newStock - oldStock;

      const res = await client.query('UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [newStock, id]);
      
      await client.query(
        `INSERT INTO inventory_logs (product_id, change_type, quantity_change, stock_after, reference_id, notes)
         VALUES ($1, 'manual_adjust', $2, $3, $4, $5)`,
        [id, diff, newStock, `ADMIN-${req.user!.id}`, reason || 'Admin manual stock adjustment']
      );

      return res.rows[0];
    });

    await logAudit(req.user!.id, 'admin', 'STOCK_ADJUSTED', 'products', id, `Adjusted stock to ${newStock} (${reason || 'Manual'})`);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Order Management (Business Rules & Transactions)
// ----------------------------------------------------
// Rule 1: Delivery charge: Below ₹299 -> ₹25, ₹299 and above -> ₹0
// Rule 2: Handling charge: ₹5 per order
// Rule 3: Payment mode: Cash on Delivery (COD) only
// Rule 4: Centralized warehouse in Karanja Lad
// Rule 5: Stock reserved atomically with rollback on insufficient inventory
app.post('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { items, customer_name, customer_phone, delivery_address, landmark, pincode } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Please add items to checkout.' });
    }

    const cleanPhone = (customer_phone || req.user!.phone).trim().replace(/\D/g, '');
    const recipientName = (customer_name || req.user!.name).trim();
    const address = (delivery_address || req.user!.address || '').trim();

    if (!recipientName || !cleanPhone || !address) {
      return res.status(400).json({ error: 'Recipient name, mobile number, and delivery address are mandatory.' });
    }

    const orderNumber = `FMP-KL-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const newOrder = await withTransaction(async (client) => {
      let subtotal = 0;
      const validatedItems: any[] = [];

      // Atomic verification and stock reservation
      for (const item of items) {
        const prodRes = await client.query('SELECT * FROM products WHERE id = $1 AND (is_active IS NULL OR is_active = TRUE)', [item.product_id]);
        if (prodRes.rows.length === 0) {
          throw new Error(`Product "${item.name || item.product_id}" is no longer available.`);
        }
        const product = prodRes.rows[0];
        const requestedQty = parseInt(item.quantity, 10);

        if (requestedQty <= 0) {
          throw new Error(`Invalid quantity for ${product.name}`);
        }

        if (product.stock < requestedQty) {
          throw new Error(`Insufficient stock for "${product.name}". Only ${product.stock} units remaining.`);
        }

        const itemTotal = Number(product.price) * requestedQty;
        subtotal += itemTotal;

        // Deduct stock immediately (atomic reservation)
        const updatedStock = product.stock - requestedQty;
        await client.query('UPDATE products SET stock = $1 WHERE id = $2', [updatedStock, product.id]);

        // Inventory audit log
        await client.query(
          `INSERT INTO inventory_logs (product_id, change_type, quantity_change, stock_after, reference_id, notes)
           VALUES ($1, 'order_reserve', $2, $3, $4, $5)`,
          [product.id, -requestedQty, updatedStock, orderNumber, `Reserved for order ${orderNumber}`]
        );

        validatedItems.push({
          product_id: product.id,
          product_name: product.name,
          unit: product.unit,
          price: product.price,
          quantity: requestedQty,
          total: itemTotal,
          image_url: product.image_url
        });
      }

      // Business Rules for Delivery Charges (Admin-controlled, no automatic ₹299 threshold)
      const settingsRes = await client.query('SELECT * FROM delivery_settings LIMIT 1');
      const settings = settingsRes.rows[0];
      let deliveryFee = settings ? Number(settings.default_delivery_fee) : 25;

      // Area-based delivery fee matching if configured
      if (settings && settings.delivery_areas && (req.body.landmark || address)) {
        try {
          const areas = typeof settings.delivery_areas === 'string' ? JSON.parse(settings.delivery_areas) : settings.delivery_areas;
          const searchStr = `${req.body.landmark || ''} ${address || ''}`.toLowerCase();
          const matchedArea = areas.find((a: any) => searchStr.includes(a.area.toLowerCase()));
          if (matchedArea && typeof matchedArea.fee === 'number') {
            deliveryFee = matchedArea.fee;
          }
        } catch (e) {}
      }

      // Explicit delivery fee override if passed by admin or promotional coupon
      if (typeof req.body.delivery_fee === 'number' && req.body.delivery_fee >= 0) {
        deliveryFee = Number(req.body.delivery_fee);
      }

      const handlingFee = settings ? Number(settings.handling_fee) : 5;
      const tipAmount = Math.max(0, Math.round(Number(req.body.tip_amount) || 0));
      const totalAmount = subtotal + deliveryFee + handlingFee + tipAmount;

      // Insert Order with scheduling and default false flags
      const deliveryType = req.body.delivery_type === 'scheduled' ? 'scheduled' : 'immediate';
      const scheduledDate = req.body.scheduled_date || (deliveryType === 'scheduled' ? 'Today' : 'Immediate Express');
      const timeSlot = req.body.time_slot || (deliveryType === 'scheduled' ? '09:00 AM - 12:00 PM' : 'Within 45-60 mins');

      const orderRes = await client.query(
        `INSERT INTO orders (
          order_number, customer_id, customer_name, customer_phone,
          delivery_address, landmark, pincode, subtotal, delivery_fee, handling_fee, tip_amount, total_amount,
          payment_mode, status, delivery_type, scheduled_date, time_slot, cod_collected, cod_reconciled
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'COD', 'placed', $13, $14, $15, FALSE, FALSE
        ) RETURNING *`,
        [
          orderNumber,
          req.user!.id,
          recipientName,
          cleanPhone,
          address,
          landmark || 'Karanja Lad',
          pincode || '444105',
          subtotal,
          deliveryFee,
          handlingFee,
          tipAmount,
          totalAmount,
          deliveryType,
          scheduledDate,
          timeSlot
        ]
      );

      const order = orderRes.rows[0];

      // Insert Order Items
      for (const it of validatedItems) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit, price, quantity, total, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [order.id, it.product_id, it.product_name, it.unit, it.price, it.quantity, it.total, it.image_url]
        );
      }

      // Customer Notification
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
         VALUES ($1, 'Order Placed Successfully! 🎉', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
        [
          req.user!.id,
          `Your FMP Supermart order #${orderNumber} for ₹${totalAmount} has been placed. Payment via Cash on Delivery.`,
          order.id
        ]
      );

      // Admin Notifications for Central Hub
      const adminUsers = await client.query("SELECT id FROM users WHERE role = 'admin'");
      for (const adm of adminUsers.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
           VALUES ($1, 'New Order Received! 🛒', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
          [
            adm.id,
            `New order #${orderNumber} for ₹${totalAmount} placed by ${recipientName} (${cleanPhone}).`,
            order.id
          ]
        );
      }

      return { ...order, items: validatedItems };
    });

    await logAudit(req.user!.id, req.user!.role, 'ORDER_PLACED', 'orders', newOrder.id, `Order ${newOrder.order_number} placed for ₹${newOrder.total_amount}`);

    res.status(201).json({
      message: 'Order placed successfully!',
      order: newOrder
    });
  } catch (err: any) {
    console.error('Order placement error:', err);
    res.status(400).json({ error: err.message || 'Failed to place order.' });
  }
});

// Get orders list (Role-filtered)
app.get('/api/orders', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    let query = `SELECT * FROM orders`;
    const params: any[] = [];

    if (req.user!.role === 'customer') {
      params.push(req.user!.id);
      query += ` WHERE customer_id = $1`;
    } else if (req.user!.role === 'rider') {
      params.push(req.user!.id);
      query += ` WHERE rider_id = $1`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await db.query(query, params);

    // Filter OTP from general list for security
    const sanitized = result.rows.map(o => {
      const isCustomerOwner = req.user!.role === 'customer' && o.customer_id === req.user!.id;
      return {
        ...o,
        // Only customer sees delivery OTP when order is dispatched or delivered
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
    const db = await getDb();

    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const order = orderRes.rows[0];

    // Authorization check
    if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (req.user!.role === 'rider' && order.rider_id !== req.user!.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const itemsRes = await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC', [id]);

    const isCustomerOwner = req.user!.role === 'customer' && order.customer_id === req.user!.id;
    const canSeeOtp = (isCustomerOwner || req.user!.role === 'admin') && ['dispatched', 'delivered'].includes(order.status);

    res.json({
      ...order,
      delivery_otp: canSeeOtp ? order.delivery_otp : undefined,
      items: itemsRes.rows
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

    const cancelledOrder = await withTransaction(async (client) => {
      const orderRes = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
      if (orderRes.rows.length === 0) throw new Error('Order not found.');
      const order = orderRes.rows[0];

      if (req.user!.role === 'customer' && order.customer_id !== req.user!.id) {
        throw new Error('You cannot cancel another customer’s order.');
      }

      if (['delivered', 'cancelled'].includes(order.status)) {
        throw new Error(`Order cannot be cancelled because it is already ${order.status}.`);
      }

      if (order.status === 'dispatched' && req.user!.role === 'customer') {
        throw new Error('Order is already out for delivery. Please contact FMP Supermart support to cancel.');
      }

      // Restore reserved stock for all items
      const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
      for (const item of itemsRes.rows) {
        const prodRes = await client.query('SELECT stock FROM products WHERE id = $1', [item.product_id]);
        if (prodRes.rows.length > 0) {
          const restoredStock = prodRes.rows[0].stock + item.quantity;
          await client.query('UPDATE products SET stock = $1 WHERE id = $2', [restoredStock, item.product_id]);
          await client.query(
            `INSERT INTO inventory_logs (product_id, change_type, quantity_change, stock_after, reference_id, notes)
             VALUES ($1, 'order_cancel_restore', $2, $3, $4, $5)`,
            [item.product_id, item.quantity, restoredStock, order.order_number, `Restored from cancelled order ${order.order_number}`]
          );
        }
      }

      const updated = await client.query(
        `UPDATE orders 
         SET status = 'cancelled', failure_reason = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 RETURNING *`,
        [reason || 'Cancelled by ' + req.user!.role, id]
      );

      // Notification to Customer
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
         VALUES ($1, 'Order Cancelled', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
        [order.customer_id, `Order #${order.order_number} has been cancelled. Reserved items have been released.`, id]
      );

      // Notification to Admin
      const adminUsers = await client.query("SELECT id FROM users WHERE role = 'admin'");
      for (const adm of adminUsers.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
           VALUES ($1, 'Order Cancelled ⚠️', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
          [adm.id, `Order #${order.order_number} was cancelled by ${req.user!.name} (${req.user!.role}). Stock was restored.`, id]
        );
      }

      // Notification to Rider if assigned
      if (order.rider_id) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
           VALUES ($1, 'Assigned Order Cancelled', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
          [order.rider_id, `Assigned order #${order.order_number} was cancelled. Do not deliver this package.`, id]
        );
      }

      return updated.rows[0];
    });

    await logAudit(req.user!.id, req.user!.role, 'ORDER_CANCELLED', 'orders', id, `Cancelled order #${cancelledOrder.order_number}`);
    res.json({ message: 'Order cancelled and stock restored successfully.', order: cancelledOrder });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Admin Operations & Order Processing
// ----------------------------------------------------
// Update order status (confirmed, packed)
app.put('/api/orders/:id/status', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!['confirmed', 'packed'].includes(status)) {
      return res.status(400).json({ error: 'Use specific endpoints for dispatch, deliver, or cancel.' });
    }

    const db = await getDb();
    const result = await db.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [status, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = result.rows[0];

    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, order_id)
       VALUES ($1, $2, $3, 'order', $4)`,
      [order.customer_id, `Order Status Update: ${status.toUpperCase()}`, `Your order #${order.order_number} is now ${status}.`, id]
    );

    await logAudit(req.user!.id, 'admin', 'ORDER_STATUS_UPDATE', 'orders', id, `Status updated to ${status}`);
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List riders for assignment and fleet management
app.get('/api/admin/riders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT u.id, u.name, u.phone, u.email, u.address, u.landmark, u.is_active,
              COUNT(CASE WHEN o.status IN ('placed', 'confirmed', 'packed', 'dispatched') THEN 1 END) as assigned_deliveries,
              COUNT(CASE WHEN o.status = 'dispatched' THEN 1 END) as active_deliveries,
              COUNT(CASE WHEN o.status = 'delivered' THEN 1 END) as total_delivered,
              COUNT(CASE WHEN o.failure_reason IS NOT NULL THEN 1 END) as failed_deliveries,
              COUNT(CASE WHEN o.status = 'delivered' AND o.cod_reconciled = FALSE THEN 1 END) as unreconciled_orders,
              COALESCE(SUM(CASE WHEN o.status = 'delivered' AND o.cod_reconciled = FALSE THEN o.total_amount ELSE 0 END), 0) as cash_in_hand
       FROM users u
       LEFT JOIN orders o ON u.id = o.rider_id
       WHERE u.role = 'rider'
       GROUP BY u.id, u.name, u.phone, u.email, u.address, u.landmark, u.is_active
       ORDER BY u.name ASC`
    );
    res.json(result.rows);
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

    const db = await getDb();
    const existing = await db.query('SELECT id FROM users WHERE phone = $1 AND role = $2', [cleanPhone, 'rider']);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A delivery rider with this mobile number already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (phone, name, email, role, password_hash, address, landmark, city, pincode, is_active)
       VALUES ($1, $2, $3, 'rider', $4, $5, $6, 'Karanja Lad', '444105', TRUE)
       RETURNING id, name, phone, email, address, landmark, is_active`,
      [cleanPhone, name.trim(), email?.trim() || null, passwordHash, address?.trim() || 'Karanja Lad', landmark?.trim() || null]
    );

    const rider = result.rows[0];
    await logAudit(req.user!.id, 'admin', 'RIDER_CREATED', 'users', rider.id, `Created delivery partner account for ${rider.name} (${cleanPhone})`);

    // Welcome notification for rider
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
       VALUES ($1, 'Welcome to FMP Supermart Fleet! 🛵', $2, 'account', FALSE, CURRENT_TIMESTAMP)`,
      [rider.id, `Welcome ${rider.name}! Your delivery partner account is active. Admin will assign delivery orders to you.`]
    );

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

    const db = await getDb();
    const result = await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           address = COALESCE($4, address),
           landmark = COALESCE($5, landmark),
           is_active = COALESCE($6, is_active)
       WHERE id = $7 AND role = 'rider'
       RETURNING id, name, phone, email, address, landmark, is_active`,
      [name?.trim(), phone ? phone.trim().replace(/\D/g, '') : null, email?.trim(), address?.trim(), landmark?.trim(), is_active, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Delivery rider not found.' });

    await logAudit(req.user!.id, 'admin', 'RIDER_UPDATED', 'users', id, `Updated delivery partner profile for ${result.rows[0].name}`);
    res.json({ message: 'Rider details updated.', rider: result.rows[0] });
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

    const passwordHash = await bcrypt.hash(password, 10);
    const db = await getDb();
    const result = await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 AND role = $3 RETURNING id, name, phone',
      [passwordHash, id, 'rider']
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Delivery rider not found.' });

    await logAudit(req.user!.id, 'admin', 'RIDER_PASSWORD_RESET', 'users', id, `Reset password for rider ${result.rows[0].name}`);
    res.json({ message: `Password successfully reset for ${result.rows[0].name}.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign or Reassign rider to order
app.post('/api/orders/:id/assign-rider', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { rider_id } = req.body;

    const db = await getDb();
    const riderRes = await db.query('SELECT id, name, phone, is_active FROM users WHERE id = $1 AND role = $2', [rider_id, 'rider']);
    if (riderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Delivery rider not found.' });
    }
    const rider = riderRes.rows[0];

    // Prevent assigning to inactive delivery partners
    if (rider.is_active === false) {
      return res.status(400).json({ error: 'Cannot assign order to an inactive delivery partner. Please activate their account first.' });
    }

    const currentOrderRes = await db.query('SELECT rider_id, rider_name, order_number, customer_name, delivery_address, status FROM orders WHERE id = $1', [id]);
    if (currentOrderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const currentOrder = currentOrderRes.rows[0];

    // Prevent duplicate active ownership
    if (currentOrder.rider_id === rider.id) {
      return res.json({ message: `Order #${currentOrder.order_number} is already assigned to ${rider.name}.`, order: currentOrder });
    }

    const isReassignment = !!currentOrder.rider_id;
    const oldRiderName = currentOrder.rider_name || 'Unassigned';

    const result = await db.query(
      `UPDATE orders 
       SET rider_id = $1, rider_name = $2, rider_phone = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [rider.id, rider.name, rider.phone, id]
    );

    const order = result.rows[0];

    // Notification to new rider
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
       VALUES ($1, 'New Order Assigned 🛵', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
      [rider.id, `Order #${order.order_number} to ${order.customer_name} (${order.delivery_address}) assigned to you.`, id]
    );

    // Notification to customer
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
       VALUES ($1, 'Delivery Partner Assigned 🛵', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
      [order.customer_id, `Delivery partner ${rider.name} (${rider.phone}) has been assigned to deliver order #${order.order_number}.`, id]
    );

    const auditAction = isReassignment ? 'RIDER_REASSIGNED' : 'RIDER_ASSIGNED';
    const auditText = isReassignment
      ? `Reassigned order #${order.order_number} from ${oldRiderName} to ${rider.name}`
      : `Assigned rider ${rider.name} to order #${order.order_number}`;

    await logAudit(req.user!.id, 'admin', auditAction, 'orders', id, auditText);
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Set/Update delivery fee for an individual order (including ₹0)
app.put('/api/orders/:id/delivery-fee', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { delivery_fee } = req.body;

    if (delivery_fee === undefined || isNaN(Number(delivery_fee)) || Number(delivery_fee) < 0) {
      return res.status(400).json({ error: 'Please specify a valid delivery fee (₹0 or greater).' });
    }

    const newFee = Number(delivery_fee);
    const db = await getDb();

    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = orderRes.rows[0];

    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot alter delivery fee for an order that is already ${order.status}.` });
    }

    const oldFee = Number(order.delivery_fee);
    const tip = Number(order.tip_amount) || 0;
    const newTotal = Number(order.subtotal) + newFee + Number(order.handling_fee) + tip;

    const updateRes = await db.query(
      `UPDATE orders 
       SET delivery_fee = $1, total_amount = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [newFee, newTotal, id]
    );

    const updatedOrder = updateRes.rows[0];

    // Notification to customer
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, order_id)
       VALUES ($1, 'Order Delivery Fee Updated', $2, 'order', $3)`,
      [
        order.customer_id,
        `Delivery fee for order #${order.order_number} was adjusted from ₹${oldFee} to ₹${newFee}. New payable COD amount: ₹${newTotal}.`,
        id
      ]
    );

    await logAudit(
      req.user!.id,
      'admin',
      'ORDER_DELIVERY_FEE_UPDATED',
      'orders',
      id,
      `Adjusted delivery fee from ₹${oldFee} to ₹${newFee}. Total COD payable updated to ₹${newTotal}.`
    );

    res.json({ message: `Delivery fee updated to ₹${newFee}. Total payable: ₹${newTotal}.`, order: updatedOrder });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dispatch order: Generates secure customer-only Delivery OTP
app.post('/api/orders/:id/dispatch', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await getDb();

    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = orderRes.rows[0];

    if (!order.rider_id) {
      return res.status(400).json({ error: 'Please assign a delivery rider before dispatching the order.' });
    }

    const deliveryOtp = generateDeliveryOTP();
    // Expiry: 24 hours from now
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.query(
      `UPDATE orders 
       SET status = 'dispatched', delivery_otp = $1, otp_expires_at = $2, otp_attempts = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [deliveryOtp, expiresAt, id]
    );

    const dispatchedOrder = result.rows[0];

    // Customer Notification with instructions
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, order_id)
       VALUES ($1, 'Order Out for Delivery! 🚀', $2, 'order', $3)`,
      [
        dispatchedOrder.customer_id,
        `Your order #${dispatchedOrder.order_number} is out for delivery with ${dispatchedOrder.rider_name || 'our delivery partner'}. Keep ₹${dispatchedOrder.total_amount} ready in cash. Share your secure OTP only when you receive your package.`,
        id
      ]
    );

    // Rider Notification
    await db.query(
      `INSERT INTO notifications (user_id, title, message, type, order_id)
       VALUES ($1, 'Order Ready for Pickup & Delivery', $2, 'order', $3)`,
      [
        dispatchedOrder.rider_id,
        `Order #${dispatchedOrder.order_number} has been dispatched. Please pick up package from central warehouse and deliver to ${dispatchedOrder.customer_name}. Collect COD: ₹${dispatchedOrder.total_amount}.`,
        id
      ]
    );

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
    const db = await getDb();

    const ordersStat = await db.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'placed' THEN 1 END) as placed_count,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
        COUNT(CASE WHEN status = 'packed' THEN 1 END) as packed_count,
        COUNT(CASE WHEN status = 'dispatched' THEN 1 END) as dispatched_count,
        COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN total_amount ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN total_amount ELSE 0 END), 0) as today_revenue,
        COALESCE(SUM(CASE WHEN cod_collected = TRUE AND cod_reconciled = FALSE THEN total_amount ELSE 0 END), 0) as unreconciled_cash
      FROM orders
    `);

    const inventoryStat = await db.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN stock = 0 THEN 1 END) as out_of_stock,
        COUNT(CASE WHEN stock > 0 AND stock <= 10 THEN 1 END) as low_stock,
        COALESCE(SUM(stock), 0) as total_units_in_stock
      FROM products
      WHERE is_active = TRUE
    `);

    const lowStockItems = await db.query(`
      SELECT id, name, unit, price, stock, image_url
      FROM products
      WHERE is_active = TRUE AND stock <= 10
      ORDER BY stock ASC
      LIMIT 10
    `);

    const recentOrders = await db.query(`
      SELECT id, order_number, customer_name, total_amount, status, created_at, cod_collected
      FROM orders
      ORDER BY created_at DESC
      LIMIT 8
    `);

    res.json({
      orders: ordersStat.rows[0],
      inventory: inventoryStat.rows[0],
      lowStockItems: lowStockItems.rows,
      recentOrders: recentOrders.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Reports (Sales, Category Volume, Daily Trend)
app.get('/api/admin/reports', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();

    const categorySales = await db.query(`
      SELECT c.name as category, COUNT(oi.id) as units_sold, COALESCE(SUM(oi.total), 0) as revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'delivered'
      GROUP BY c.name
      ORDER BY revenue DESC
    `);

    const inventoryLogs = await db.query(`
      SELECT il.*, p.name as product_name
      FROM inventory_logs il
      JOIN products p ON il.product_id = p.id
      ORDER BY il.created_at DESC
      LIMIT 25
    `);

    res.json({
      categorySales: categorySales.rows,
      inventoryLogs: inventoryLogs.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Audit Logs
app.get('/api/admin/audit-logs', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Suppliers & Purchase Orders
// ----------------------------------------------------
app.get('/api/suppliers', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query('SELECT * FROM suppliers ORDER BY id ASC');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, contact_person, phone, email, address, gst_number } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Supplier name and phone are required.' });

    const db = await getDb();
    const result = await db.query(
      `INSERT INTO suppliers (name, contact_person, phone, email, address, gst_number)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, contact_person, phone, email, address, gst_number]
    );

    await logAudit(req.user!.id, 'admin', 'SUPPLIER_CREATED', 'suppliers', result.rows[0].id, `Added supplier ${name}`);
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/purchase-orders', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(`
      SELECT po.*, 
             COUNT(poi.id) as item_count
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
      GROUP BY po.id
      ORDER BY po.created_at DESC
    `);
    res.json(result.rows);
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

    const poNumber = `PO-KL-${Date.now().toString().slice(-6)}`;

    const newPO = await withTransaction(async (client) => {
      const supRes = await client.query('SELECT name FROM suppliers WHERE id = $1', [supplier_id]);
      if (supRes.rows.length === 0) throw new Error('Supplier not found.');
      const supplierName = supRes.rows[0].name;

      let totalAmount = 0;
      for (const item of items) {
        totalAmount += Number(item.cost_price) * Number(item.quantity);
      }

      const poRes = await client.query(
        `INSERT INTO purchase_orders (po_number, supplier_id, supplier_name, status, total_amount, notes)
         VALUES ($1, $2, $3, 'pending', $4, $5) RETURNING *`,
        [poNumber, supplier_id, supplierName, totalAmount, notes || null]
      );
      const po = poRes.rows[0];

      for (const item of items) {
        const itemTotal = Number(item.cost_price) * Number(item.quantity);
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, product_name, quantity, cost_price, total)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [po.id, item.product_id, item.product_name, item.quantity, item.cost_price, itemTotal]
        );
      }

      return po;
    });

    await logAudit(req.user!.id, 'admin', 'PURCHASE_ORDER_CREATED', 'purchase_orders', newPO.id, `Created PO ${poNumber}`);
    res.status(201).json(newPO);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Receive Purchase Order (Increases product stock & logs inventory)
app.post('/api/purchase-orders/:id/receive', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);

    const receivedPO = await withTransaction(async (client) => {
      const poRes = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
      if (poRes.rows.length === 0) throw new Error('Purchase order not found.');
      const po = poRes.rows[0];

      if (po.status === 'received') throw new Error('Purchase order has already been received.');

      const itemsRes = await client.query('SELECT * FROM purchase_order_items WHERE purchase_order_id = $1', [id]);
      for (const item of itemsRes.rows) {
        const prodRes = await client.query('SELECT stock FROM products WHERE id = $1', [item.product_id]);
        if (prodRes.rows.length > 0) {
          const currentStock = prodRes.rows[0].stock;
          const newStock = currentStock + item.quantity;
          await client.query('UPDATE products SET stock = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, item.product_id]);

          await client.query(
            `INSERT INTO inventory_logs (product_id, change_type, quantity_change, stock_after, reference_id, notes)
             VALUES ($1, 'purchase_receive', $2, $3, $4, $5)`,
            [item.product_id, item.quantity, newStock, po.po_number, `Received via PO ${po.po_number}`]
          );
        }
      }

      const updated = await client.query(
        `UPDATE purchase_orders SET status = 'received', received_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [id]
      );

      return updated.rows[0];
    });

    await logAudit(req.user!.id, 'admin', 'PURCHASE_ORDER_RECEIVED', 'purchase_orders', id, `Received PO ${receivedPO.po_number}`);
    res.json({ message: 'Purchase order received and inventory updated.', po: receivedPO });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Delivery Boy / Rider Operations
// ----------------------------------------------------
// Rider assigned orders
app.get('/api/rider/assigned-orders', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT * FROM orders WHERE rider_id = $1 ORDER BY created_at DESC`,
      [req.user!.id]
    );

    // Riders do NOT receive delivery_otp in their payload!
    // Sort in memory by priority status: dispatched first
    const sanitized = result.rows
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
// Rule: Order marked delivered ONLY after successful OTP verification
// Cash on Delivery collected at the same time
app.post('/api/rider/orders/:id/verify-otp-deliver', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { otp } = req.body;

    if (!otp || !otp.toString().trim()) {
      return res.status(400).json({ error: 'Please enter the 4-digit Delivery OTP provided by the customer.' });
    }

    const inputOtp = otp.toString().trim();

    const deliveredOrder = await withTransaction(async (client) => {
      const orderRes = await client.query('SELECT * FROM orders WHERE id = $1', [id]);
      if (orderRes.rows.length === 0) throw new Error('Order not found.');
      const order = orderRes.rows[0];

      if (req.user!.role === 'rider' && order.rider_id !== req.user!.id) {
        throw new Error('This order is not assigned to you.');
      }

      if (order.status === 'delivered') {
        throw new Error('Order has already been delivered and verified.');
      }

      if (order.status !== 'dispatched') {
        throw new Error(`Order must be dispatched before OTP verification. Current status: ${order.status}`);
      }

      if (order.otp_attempts >= 5) {
        throw new Error('Maximum OTP verification attempts exceeded. Please contact admin.');
      }

      // Check OTP match
      if (order.delivery_otp !== inputOtp) {
        await client.query('UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = $1', [id]);
        throw new Error('Incorrect Delivery OTP. Please verify with the customer.');
      }

      // Mark delivered & record COD collection
      const result = await client.query(
        `UPDATE orders 
         SET status = 'delivered', 
             cod_collected = TRUE, 
             cod_collected_at = CURRENT_TIMESTAMP, 
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [id]
      );

      const delivered = result.rows[0];

      // Customer Notification
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
         VALUES ($1, 'Order Delivered! 🛍️', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
        [
          delivered.customer_id,
          `Your order #${delivered.order_number} has been delivered by ${req.user!.name}. ₹${delivered.total_amount} COD received. Thank you for choosing FMP Supermart Karanja Lad!`,
          id
        ]
      );

      // Admin Notifications
      const adminUsers = await client.query("SELECT id FROM users WHERE role = 'admin'");
      for (const adm of adminUsers.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, title, message, type, is_read, order_id, created_at)
           VALUES ($1, 'Order Delivered & COD Collected ✅', $2, 'order', FALSE, $3, CURRENT_TIMESTAMP)`,
          [
            adm.id,
            `Order #${delivered.order_number} delivered by ${req.user!.name}. Collected ₹${delivered.total_amount} in Cash.`,
            id
          ]
        );
      }

      return delivered;
    });

    await logAudit(
      req.user!.id,
      req.user!.role,
      'ORDER_DELIVERED_OTP_VERIFIED',
      'orders',
      id,
      `Order #${deliveredOrder.order_number} marked DELIVERED after valid OTP verification. Collected ₹${deliveredOrder.total_amount} COD.`
    );

    res.json({
      message: 'Delivery OTP verified successfully! Order marked as DELIVERED.',
      order: deliveredOrder
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Rider report delivery failure
app.post('/api/rider/orders/:id/report-failed', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Failure reason is required (e.g. Customer door locked, Customer unreachable).' });
    }

    const db = await getDb();
    const result = await db.query(
      `UPDATE orders 
       SET failure_reason = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [reason.trim(), id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found.' });
    const order = result.rows[0];

    await logAudit(req.user!.id, 'rider', 'DELIVERY_FAILED_REPORT', 'orders', id, `Reported failure: ${reason}`);

    res.json({ message: 'Delivery attempt issue recorded.', order });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rider COD Summary & Cash in hand
app.get('/api/rider/cod-summary', requireAuth, requireRole(['rider', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const riderId = req.user!.id;

    const summaryRes = await db.query(
      `SELECT 
         COUNT(CASE WHEN cod_collected = TRUE THEN 1 END) as total_collected_orders,
         COALESCE(SUM(CASE WHEN cod_collected = TRUE THEN total_amount ELSE 0 END), 0) as total_cash_collected,
         COALESCE(SUM(CASE WHEN cod_collected = TRUE THEN tip_amount ELSE 0 END), 0) as total_tips_collected,
         COUNT(CASE WHEN cod_collected = TRUE AND (cod_reconciled IS NULL OR cod_reconciled = FALSE) THEN 1 END) as pending_reconcile_orders,
         COALESCE(SUM(CASE WHEN cod_collected = TRUE AND (cod_reconciled IS NULL OR cod_reconciled = FALSE) THEN total_amount ELSE 0 END), 0) as cash_in_hand,
         COUNT(CASE WHEN cod_reconciled = TRUE THEN 1 END) as reconciled_orders,
         COALESCE(SUM(CASE WHEN cod_reconciled = TRUE THEN total_amount ELSE 0 END), 0) as reconciled_amount
       FROM orders
       WHERE rider_id = $1`,
      [riderId]
    );

    const pendingOrders = await db.query(
      `SELECT id, order_number, customer_name, delivery_address, total_amount, tip_amount, cod_collected_at
       FROM orders
       WHERE rider_id = $1 AND cod_collected = TRUE AND (cod_reconciled IS NULL OR cod_reconciled = FALSE)
       ORDER BY cod_collected_at DESC`,
      [riderId]
    );

    res.json({
      summary: summaryRes.rows[0],
      pendingOrders: pendingOrders.rows
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// COD Reconciliation (Admin)
// Prevents duplicate reconciliation
// ----------------------------------------------------
app.get('/api/admin/cod-pending', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(`
      SELECT 
        u.id as rider_id,
        u.name as rider_name,
        u.phone as rider_phone,
        COUNT(o.id) as unreconciled_order_count,
        COALESCE(SUM(o.total_amount), 0) as total_cash_pending
      FROM users u
      JOIN orders o ON u.id = o.rider_id
      WHERE u.role = 'rider' AND o.cod_collected = TRUE AND (o.cod_reconciled IS NULL OR o.cod_reconciled = FALSE)
      GROUP BY u.id, u.name, u.phone
      ORDER BY total_cash_pending DESC
    `);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/cod-reconcile', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { rider_id, notes } = req.body;
    if (!rider_id) return res.status(400).json({ error: 'Rider ID is required.' });

    const reconciliationNumber = `REC-KL-${Date.now().toString().slice(-6)}`;

    const result = await withTransaction(async (client) => {
      // Find orders that are collected but NOT yet reconciled (prevents duplicate reconciliation)
      const pendingRes = await client.query(
        `SELECT id, order_number, total_amount 
         FROM orders 
         WHERE rider_id = $1 AND cod_collected = TRUE AND (cod_reconciled IS NULL OR cod_reconciled = FALSE)`,
        [rider_id]
      );

      if (pendingRes.rows.length === 0) {
        throw new Error('No pending COD cash to reconcile for this delivery rider.');
      }

      const orderIds = pendingRes.rows.map(o => o.id);
      const totalAmount = pendingRes.rows.reduce((sum, o) => sum + Number(o.total_amount), 0);

      const riderRes = await client.query('SELECT name FROM users WHERE id = $1', [rider_id]);
      const riderName = riderRes.rows[0]?.name || 'Rider';

      // Mark orders reconciled individually to ensure cross-database compatibility
      for (const orderId of orderIds) {
        await client.query(
          'UPDATE orders SET cod_reconciled = TRUE, cod_reconciled_at = CURRENT_TIMESTAMP WHERE id = $1',
          [orderId]
        );
      }

      // Insert reconciliation record
      const recRes = await client.query(
        `INSERT INTO cod_reconciliations (
          reconciliation_number, rider_id, rider_name, total_amount, order_count, order_ids, reconciled_by, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [reconciliationNumber, rider_id, riderName, totalAmount, orderIds.length, JSON.stringify(orderIds), req.user!.id, notes || null]
      );

      // Send notification to rider
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type)
         VALUES ($1, 'COD Cash Handed Over & Reconciled ✅', $2, 'reconciliation')`,
        [
          rider_id,
          `Admin reconciled ₹${totalAmount} collected across ${orderIds.length} orders (Ref: #${reconciliationNumber}).`
        ]
      );

      return recRes.rows[0];
    });

    await logAudit(req.user!.id, 'admin', 'COD_RECONCILED', 'cod_reconciliations', result.id, `Reconciled ₹${result.total_amount} from rider ${result.rider_name}`);
    res.json({ message: 'COD cash successfully reconciled.', reconciliation: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Notifications
app.get('/api/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await getDb();
    await db.query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [id, req.user!.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/mark-all-read', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user!.id]);
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
    const db = await getDb();
    const result = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug, f.created_at as favorited_at
       FROM favorites f
       JOIN products p ON f.product_id = p.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE f.customer_id = $1 AND (p.is_active IS NULL OR p.is_active = TRUE)
       ORDER BY f.id DESC`,
      [req.user!.id]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/favorites/:productId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    const db = await getDb();

    // Check if already in favorites
    const existing = await db.query(
      'SELECT id FROM favorites WHERE customer_id = $1 AND product_id = $2',
      [req.user!.id, productId]
    );

    if (existing.rows.length > 0) {
      await db.query('DELETE FROM favorites WHERE id = $1', [existing.rows[0].id]);
      return res.json({ is_favorite: false, message: 'Removed from favorites' });
    } else {
      await db.query(
        'INSERT INTO favorites (customer_id, product_id, created_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [req.user!.id, productId]
      );
      return res.json({ is_favorite: true, message: 'Added to favorites' });
    }
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
    const db = await getDb();

    const reviews = await db.query(
      `SELECT id, product_id, customer_name, rating, review_text, created_at
       FROM product_reviews
       WHERE product_id = $1 AND status = 'approved'
       ORDER BY created_at DESC`,
      [productId]
    );

    const stats = await db.query(
      `SELECT 
         COUNT(*) as review_count,
         COALESCE(AVG(rating), 0) as average_rating
       FROM product_reviews
       WHERE product_id = $1 AND status = 'approved'`,
      [productId]
    );

    res.json({
      reviews: reviews.rows,
      stats: {
        review_count: parseInt(stats.rows[0]?.review_count || '0', 10),
        average_rating: Number(parseFloat(stats.rows[0]?.average_rating || '0').toFixed(1))
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit review after delivery (Verified customer check)
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

    const db = await getDb();

    // Verified purchase check: has customer ever ordered this product in a delivered order?
    const deliveredCheck = await db.query(
      `SELECT o.id as order_id
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.customer_id = $1 AND oi.product_id = $2 AND o.status = 'delivered'
       ORDER BY o.id DESC LIMIT 1`,
      [req.user!.id, productId]
    );

    const isVerifiedPurchase = deliveredCheck.rows.length > 0;
    const orderId = isVerifiedPurchase ? deliveredCheck.rows[0].order_id : null;

    const result = await db.query(
      `INSERT INTO product_reviews (product_id, customer_id, customer_name, order_id, rating, review_text, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved') RETURNING *`,
      [productId, req.user!.id, req.user!.name, orderId, numRating, review_text.trim()]
    );

    await logAudit(
      req.user!.id,
      req.user!.role,
      'PRODUCT_REVIEW_ADDED',
      'product_reviews',
      result.rows[0].id,
      `User ${req.user!.name} rated product ${productId} ${numRating} stars`
    );

    res.status(201).json({
      message: 'Thank you for your rating & review!',
      review: result.rows[0]
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Review Moderation
app.get('/api/admin/reviews', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT pr.*, p.name as product_name, p.image_url as product_image
       FROM product_reviews pr
       JOIN products p ON pr.product_id = p.id
       ORDER BY pr.id DESC`
    );
    res.json(result.rows);
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

    const db = await getDb();
    const result = await db.query('UPDATE product_reviews SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Review not found.' });

    await logAudit(req.user!.id, 'admin', 'REVIEW_MODERATED', 'product_reviews', id, `Review status changed to ${status}`);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/reviews/:id', requireAuth, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = await getDb();
    await db.query('DELETE FROM product_reviews WHERE id = $1', [id]);
    await logAudit(req.user!.id, 'admin', 'REVIEW_DELETED', 'product_reviews', id, 'Deleted review');
    res.json({ success: true, message: 'Review deleted successfully.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// Frontend Serving Setup (Dev via Vite middlewares, Prod via Express static)
// ----------------------------------------------------
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 FMP Supermart server running on port ${PORT} (${isProduction ? 'Production' : 'Development'})`);
    console.log(`📍 Serving Karanja Lad, Maharashtra 444105`);
  });
}

// Only start listening if not running inside test environment
const isDirectRun = process.env.IS_TEST_SUITE !== 'true' && process.env.NODE_ENV !== 'test';
if (isDirectRun) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
  });
}

export default app;

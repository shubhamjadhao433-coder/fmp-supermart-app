import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'fmp_karanja_lad_supermart_jwt_secure_secret_2026_xyz';

export interface AuthUser {
  id: number;
  phone: string;
  name: string;
  role: 'customer' | 'admin' | 'rider';
  address?: string;
  landmark?: string;
  pincode?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function generateToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // Also support HttpOnly session cookie if Authorization header is not provided
  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc: Record<string, string>, item) => {
      const parts = item.trim().split('=');
      const key = parts[0]?.trim();
      const val = parts.slice(1).join('=').trim();
      if (key && val) acc[key] = decodeURIComponent(val);
      return acc;
    }, {});
    token = cookies['token'] || cookies['fmp_supermart_token'] || cookies['fmp_token'];
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const userId = parseInt(String(decoded.id), 10);
    
    // Fetch full user record to ensure current active state
    const db = await getDb();
    const userRes = await db.query(
      'SELECT id, phone, name, role, address, landmark, pincode, is_active FROM users WHERE id = $1 OR (phone = $2 AND role = $3)',
      [userId, decoded.phone, decoded.role]
    );
    if (userRes.rows.length === 0 || userRes.rows[0].is_active === false) {
      return res.status(401).json({ error: 'User account not found or deactivated.' });
    }
    
    req.user = userRes.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }
}

export function requireRole(allowedRoles: ('customer' | 'admin' | 'rider')[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: Access restricted to ${allowedRoles.join(', ')} only.` });
    }
    next();
  };
}

export async function logAudit(
  userId: number | null,
  userRole: string | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: string,
  ipAddress?: string
) {
  try {
    const db = await getDb();
    await db.query(
      `INSERT INTO audit_logs (user_id, user_role, action, entity, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, userRole, action, entity, entityId ? String(entityId) : null, details, ipAddress || 'internal']
    );
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// Generate 4-digit numeric delivery OTP
export function generateDeliveryOTP(): string {
  // 4 digits, e.g. 1000 - 9999
  return Math.floor(1000 + Math.random() * 9000).toString();
}

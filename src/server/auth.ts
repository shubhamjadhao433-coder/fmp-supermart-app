import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { usersRepo, auditLogsRepo } from './firestoreDb.ts';

function resolveJwtSecret(): string {
  const configured = (process.env.JWT_SECRET || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';
  const insecureDefaults = new Set([
    'fmp_karanja_lad_supermart_jwt_secure_secret_2026_xyz',
    'secret',
    'changeme',
    'jwt_secret'
  ]);

  if (isProduction) {
    if (!configured || configured.length < 32 || insecureDefaults.has(configured)) {
      throw new Error(
        'FATAL SECURITY ERROR: JWT_SECRET must be set to a strong random secret (at least 32 characters) in production.'
      );
    }
    return configured;
  }

  if (configured && configured.length >= 16 && !insecureDefaults.has(configured)) {
    return configured;
  }

  // Non-production ephemeral process secret (never hardcoded)
  return crypto.randomBytes(32).toString('hex');
}

const JWT_SECRET = resolveJwtSecret();

export interface AuthUser {
  id: number;
  phone: string;
  name: string;
  role: 'customer' | 'admin' | 'rider' | 'store_owner';
  store_id?: number | null;
  address?: string;
  landmark?: string;
  pincode?: string;
  is_active?: boolean;
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
      role: user.role,
      store_id: user.store_id ?? null
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
    const userId = Number(decoded?.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    // Strictly look up authenticated user by verified ID (never fall back to mutable phone/role)
    const user = await usersRepo.findById(userId);

    if (!user || user.is_active === false) {
      return res.status(401).json({ error: 'User account not found or deactivated.' });
    }

    // Invalidate JWTs issued before an administrative password reset
    if (user.password_changed_at && typeof decoded.iat === 'number') {
      const changedAtMs = new Date(user.password_changed_at).getTime();
      if (Number.isFinite(changedAtMs) && decoded.iat * 1000 < changedAtMs - 1000) {
        return res.status(401).json({ error: 'Session invalidated after password reset. Please login again.' });
      }
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      store_id: user.store_id ?? null,
      address: user.address || undefined,
      landmark: user.landmark || undefined,
      pincode: user.pincode,
      is_active: user.is_active
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }
}

export function requireRole(allowedRoles: ('customer' | 'admin' | 'rider' | 'store_owner')[]) {
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
    await auditLogsRepo.create({
      user_id: userId,
      user_role: userRole,
      action,
      entity,
      entity_id: entityId,
      details,
      ip_address: ipAddress || 'internal'
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// Cryptographically random 6-digit pickup verification code
export function generatePickupCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// Cryptographically random 4-digit OTP helper (retained only for module compatibility)
export function generateDeliveryOTP(): string {
  return crypto.randomInt(1000, 10000).toString();
}

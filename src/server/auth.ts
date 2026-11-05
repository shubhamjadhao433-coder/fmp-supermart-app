import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { usersRepo, auditLogsRepo } from './firestoreDb.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'fmp_karanja_lad_supermart_jwt_secure_secret_2026_xyz';

export interface AuthUser {
  id: number;
  phone: string;
  name: string;
  role: 'customer' | 'admin' | 'rider';
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

    // Fetch full user record from Firestore to ensure current active state
    let user = await usersRepo.findById(userId);
    if (!user && decoded.phone && decoded.role) {
      user = await usersRepo.findByPhoneAndRole(decoded.phone, decoded.role);
    }

    if (!user || user.is_active === false) {
      return res.status(401).json({ error: 'User account not found or deactivated.' });
    }

    req.user = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role,
      address: user.address || undefined,
      landmark: user.landmark || undefined,
      pincode: user.pincode,
      is_active: user.is_active
    };
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

// Generate 4-digit numeric delivery OTP
export function generateDeliveryOTP(): string {
  // 4 digits, e.g. 1000 - 9999
  return Math.floor(1000 + Math.random() * 9000).toString();
}

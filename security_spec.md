# FMP Supermart Security Specification

## 1. Architecture & Trust Boundaries
- **Marketplace Model**: Hyperlocal Multi-Store Grocery & Kirana Marketplace (Store-Managed Delivery & Store Pickup). Central warehouse operations, third-party platform riders, handling charges, tips, and monetization/ad modules are permanently retired.
- **Database Access Model**: All reads, writes, and atomic Firestore transactions flow exclusively through the Express API (`server.ts` -> `src/server/firestoreDb.ts`). Direct client SDK access is blocked by zero-trust `firestore.rules`.
- **Note on Firebase SDK Credential Model**: `src/server/firestoreDb.ts` currently connects via the Firebase Client SDK. Prior to deploying the zero-trust `firestore.rules` to production Firebase, `firestoreDb.ts` must be migrated to `firebase-admin/firestore` (or server service-account credentials).

## 2. Role & Access Control Matrix

| Resource / Action | Public (Unauth) | Customer | Store Owner | Super Admin |
|---|---|---|---|---|
| Nearby approved active stores (`GET /api/stores/nearby`) | Allow | Allow | Allow | Allow |
| Store catalog products (`GET /api/stores/:id/products`, `GET /api/products`) | Approved & active stores only | Approved & active stores only | Approved & active stores only | All stores |
| Register Customer (`POST /api/auth/register`) | Allow (`role` forced to `customer`) | — | — | — |
| Register Store (`POST /api/stores/register`) | Allow (`approval_status` forced to `pending`) | — | — | — |
| Manage Own Profile (`PUT /api/auth/profile`) | Deny (`401`) | Own profile only (no `role`/`is_active`/`store_id`) | Own profile only | Own profile only |
| Saved Addresses (`/api/addresses`) | Deny (`401`) | Own addresses only | Own addresses only | Own addresses only |
| Place Order (`POST /api/orders`) | Deny (`401`) | Active approved open store only (`store_id > 0`) | Denied/Own | Allowed |
| View Orders (`GET /api/orders`, `GET /api/orders/:id`) | Deny (`401`) | Own orders only (`pickup_code` visible only here) | Store-scoped routes only | All orders (PII masked) |
| Cancel Order (`POST /api/orders/:id/cancel`) | Deny (`401`) | Own pre-dispatch orders only | Own store orders only | Any non-terminal order |
| Store Dashboard & Catalog (`/api/store-owner/*`) | Deny (`401`) | Deny (`403`) | Own `store_id` only (`approval_status === 'approved'` & `is_active` for mutations) | Deny (`403`) |
| Complete Store Pickup Order (`PUT /api/store-owner/orders/:id/status`) | Deny (`401`) | Deny (`403`) | Requires matching 6-digit `pickup_code` (max 5 failed attempts) | Deny (`403`) |
| File Complaint (`POST /api/complaints`) | Deny (`401`) | Must reference valid entities; `order_id` must belong to reporter | Valid entities; `order_id` must belong to reporter store | Allow |
| Admin Governance (`/api/admin/*`) | Deny (`401`) | Deny (`403`) | Deny (`403`) | Allow (PII masked; monetization locked `false`) |
| Retired Warehouse & Rider APIs (`/api/rider/*`, `/api/suppliers`, `/api/purchase-orders*`, `/api/admin/riders*`, `/api/admin/cod-*`, `/api/admin/delivery-slots*`, `/api/orders/:id/assign-rider`, `/api/orders/:id/dispatch`, `/api/orders/:id/delivery-fee`, `/api/delivery/calculate-fee`, `POST/PUT/DELETE /api/products*`) | `410 Gone` | `410 Gone` | `410 Gone` | `410 Gone` |

## 3. Sensitive Fields & PII Protection
- `users.password_hash`: Never serialized in any API response.
- `orders.pickup_code`: Returned ONLY to the owning customer (`GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`). Stripped from `GET /api/store-owner/orders` and `GET /api/admin/*`. Store owners verify pickup codes via `PUT /api/store-owner/orders/:id/status`.
- `orders.delivery_otp`: Retired for new orders (`null`); stripped from store owner & admin payloads.
- Customer `phone` and `delivery_address`: Masked in `/api/admin/customers*`, `/api/admin/stores/:id`, `/api/orders` (for admin), and hidden/masked on `/api/store-owner/orders` once an order reaches `delivered` or `cancelled`.
- Wholesale cost/supplier fields (`purchase_cost`, `gross_margin`, `margin_percent`, `supplier_*`): Stripped from all customer/public and store-owner catalog payloads.

## 4. Server-Derived Fields & Business Invariants
- `JWT_SECRET`: Required (>= 32 chars) in production; ephemeral secure CSPRNG fallback used only in non-production environments.
- Session Invalidation: Admin password resets stamp `password_changed_at`; any JWT issued (`iat`) prior to `password_changed_at` is rejected with `401`.
- Cart & Order Pricing: `subtotal`, `regular_subtotal`, `total_savings`, `delivery_fee`, `handling_fee = 0`, `tip_amount = 0`, and `total_amount` are calculated strictly server-side inside the Firestore transaction from active store & product documents.
- Fulfillment & Payment Rules:
  - `fulfillment_type === 'pickup'` -> `payment_mode = 'Pay at Store'`, `delivery_fee = 0`, 6-digit CSPRNG `pickup_code`.
  - `fulfillment_type === 'delivery'` -> `payment_mode = 'COD'`, store-configured `delivery_fee`, backend OSRM/Haversine distance <= `store.delivery_radius_km`.
- Monetization Lock: `monetization_enabled`, `subscriptions_enabled`, `featured_stores_enabled`, `store_ads_enabled`, `admob_enabled`, and `adsense_enabled` are strictly forced/enforced to `false`.
- Cookie & CORS Hardening: Production CORS enforces `ALLOWED_ORIGINS`; cookies are `httpOnly`, environment-aware `secure` + `sameSite`; cookie-authenticated mutating requests without Bearer auth verify `Origin`/`Referer`.

# FMP Supermart — Security Audit & Safeguards Report

**System Scope:** Express API (`server.ts`, `src/server/*`), React SPA (`src/App.tsx`, `src/components/*`, `src/services/api.ts`), Cloud Firestore (`firestore.rules`), and Legacy Snapshot (`data/fmp_db_state.json`).

---

## 1. Threat Model & Trust Boundaries

1. **Untrusted Public Entry Points**:
   - Authentication & onboarding routes (`/api/auth/register`, `/api/auth/login`, `/api/auth/forgot-password-request`, `/api/stores/register`)
   - Location lookup proxies (`/api/locations/search`, `/api/locations/reverse`)
   - Authenticated customer, store-owner, and admin API endpoints (`/api/orders`, `/api/store-owner/*`, `/api/admin/*`, `/api/complaints`, `/api/addresses`)
   - Client map labels and uploaded/linked store & product image values
2. **Authentication & Authorization Model**:
   - Signed JWTs (`jsonwebtoken`, 30-day expiry) verified on the server in `src/server/auth.ts` (`requireAuth`) via either `Authorization: Bearer` header or `HttpOnly` session cookie.
   - Server fetches the authoritative user record by numeric ID from Firestore (`usersRepo.findById`), checks `is_active !== false`, invalidates tokens issued before `password_changed_at`, and enforces role gates via `requireRole(...)` (including Admin product moderation routes `PUT /api/admin/products/:id/status` and `DELETE /api/admin/products/:id`).
   - Public self-registration (`/api/auth/register`) forces `role = 'customer'` and rejects admin roles with `403`. Store registration (`/api/stores/register`) forces `approval_status = 'pending'`.
3. **Database & PII Controls**:
   - Server strips `password_hash`, wholesale cost/margin fields, internal email/admin metadata from public store listings (`sanitizePublicStore`), and pre-completion/post-completion customer contact PII where appropriate (`pickup_code` visible only to the owning customer; admin views mask `customer_phone` and `delivery_address`; store-owner order views mask/redact customer contact details once an order is `delivered` or `cancelled`).

---

## 2. Vulnerabilities Identified & Remediated

| Finding | Severity | Location | Issue & Resolution | Status |
|---|---|---|---|---|
| Sensitive Legacy Data File on Disk | High | `data/fmp_db_state.json` | Unused JSON snapshot from archived `src/server/db.ts.archived` still held 87 user records (passwords hashed with bcrypt, phone numbers, emails, addresses) and 117 historical orders. Replaced file contents with an empty schema skeleton and added an automated regression check. | Fixed |
| Permissive Fallback CORS & Missing Cookie CSRF Check When `ALLOWED_ORIGINS` Is Unset | High | `server.ts` | Cross-origin requests in production succeeded whenever `ALLOWED_ORIGINS` was blank, and cookie-authenticated mutating routes skipped origin validation in that state. Updated CORS and CSRF middleware to strictly require `ALLOWED_ORIGINS` or exact dynamic same-origin matching (`Host` / `X-Forwarded-Host`) in production and return JSON `403` responses. | Fixed |
| Missing Endpoint Rate Limiting | High | `server.ts` | Login, registration, store onboarding, password reset requests, order creation, and OpenStreetMap proxy endpoints had no request-rate limits. Enabled `trust proxy = 1` and sliding-window IP rate limiters returning HTTP `429` JSON with `Retry-After`. | Fixed |
| Client Token Storage in `localStorage`/`sessionStorage` & Cookie Flags | High | `src/services/api.ts`, `src/App.tsx`, `server.ts` | Auth tokens were cached in Web Storage (`fmp_supermart_token`), exposing bearer tokens to script reads. Kept bearer tokens strictly in JS memory (purging legacy storage keys), relied on `HttpOnly` session cookies across reloads, and updated cookie helpers for proxied HTTPS (`x-forwarded-proto`) and `Partitioned` cookies. | Fixed |
| Unvalidated External Image URLs & Map Pin HTML Interpolation | Medium | `server.ts`, `src/components/OsmMapPicker.tsx` | `sanitizeImageValue` did not block loopback/private/link-local metadata URLs or URLs with embedded credentials, and `createPinIcon` inserted pin labels into HTML without escaping. Blocked private/metadata hosts and invalid URL schemes with `400` errors, and escaped HTML special characters in map pin labels. | Fixed |
| Verbose 500 Internal Errors & Missing Hardening Headers | Medium | `server.ts` | Unexpected 500 catch blocks returned raw internal `err.message` strings and omitted `Strict-Transport-Security`, `X-DNS-Prefetch-Control`, and `Permissions-Policy`. Added these headers and masked unexpected 500 responses in `NODE_ENV=production`. | Fixed |

---

## 3. Dependency Security Check (`bun audit`)

A read-only `bun audit` scan against `bun.lock` flagged **4 transitive advisories** inside upstream dependencies (`@grpc/grpc-js` via `firebase` / `firebase-admin`, and `glob` / `minimatch` via `vite-plugin-pwa` / `firebase-admin`). No custom package code introduces these advisories, and `vite-plugin-pwa` runs strictly during build time (`vite build`). Track upstream releases of `firebase`, `firebase-admin`, and `vite-plugin-pwa` when major updates become compatible.

---

## 4. Production Architectural Requirement (Firestore Admin SDK)

`firestore.rules` correctly denies browser-side writes across every collection. However, `src/server/firestoreDb.ts` currently uses the `firebase` Web Client SDK instead of server service-account credentials (`firebase-admin/firestore`). Before deploying strict zero-trust `firestore.rules` to production Firebase, switch `src/server/firestoreDb.ts` to `firebase-admin/firestore` with server-side credentials. (Status: Documented in `DEPLOYMENT_GUIDE.md` — **Follow-up required before deploying `firestore.rules` publicly**.)

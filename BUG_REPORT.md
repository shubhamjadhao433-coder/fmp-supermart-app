# FMP Supermart — Bug & Remediation Report

**Scope:** Existing FMP Supermart Hyperlocal Multi-Store Grocery Marketplace (Karanja Lad 444105)  
**Target Stack:** React 19 + TypeScript + Vite + Tailwind CSS + Express (`server.ts`) + Cloud Firestore + Workbox PWA

---

## Summary of Issues Identified & Resolved

| ID | Severity | Component / File | Root Cause | Resolution | Status |
|---|---|---|---|---|---|
| BUG-01 | Critical | `server.ts`, `package.json` | Bundling `server.ts` into `dist/server.js` made `__dirname` resolve to `<root>/dist`, so `path.resolve(__dirname, 'dist')` and `path.resolve(__dirname, 'public')` looked inside `<root>/dist/dist` and `<root>/dist/public`, breaking `npm start` SPA & PWA asset serving. | Resolved `distPath` dynamically across `__dirname`, `__dirname/dist`, and `process.cwd()/dist` (checking for `index.html`), and `publicDirPath` across `__dirname/public`, `process.cwd()/public`, and `__dirname/../public`. | Fixed |
| BUG-02 | High | `data/fmp_db_state.json` | Leftover JSON snapshot from archived `src/server/db.ts.archived` still held 87 user records (names, phone numbers, addresses, password hashes) and 117 orders on disk despite Firestore being the active database. | Sanitized `data/fmp_db_state.json` to an empty schema structure with zero user/order PII and added an automated test guard. | Fixed |
| BUG-03 | High | `server.ts` | When `ALLOWED_ORIGINS` was unset in `NODE_ENV=production`, CORS allowed any external `Origin` (`allowedOrigins.length === 0`) and skipped cookie-CSRF origin checks. Error handler also risked non-JSON responses on CORS rejection. | Restricted production cross-origin access to `ALLOWED_ORIGINS` (or exact dynamic same-origin `Host` / `X-Forwarded-Host` if unset), returning JSON `403`, and extended cookie CSRF validation across all production state-changing routes. | Fixed |
| BUG-04 | High | `server.ts` | Auth (`/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password-request`), store onboarding (`/api/stores/register`), checkout (`/api/orders`), and OSM lookup routes lacked rate limiting. | Enabled `app.set('trust proxy', 1)` and sliding-window IP rate limiters returning HTTP `429` JSON and `Retry-After` headers. | Fixed |
| BUG-05 | High | `src/services/api.ts`, `src/App.tsx`, `server.ts` | `authStorage` persisted bearer JWTs in `localStorage` and `sessionStorage` alongside `HttpOnly` cookies, and auth cookies lacked `Partitioned` (CHIPS) & `x-forwarded-proto` HTTPS detection for proxied deployments. | Held bearer tokens strictly in JS memory (purging legacy Web Storage keys), relied on `HttpOnly` cookies on reload, synced cross-tab state via non-secret `fmp_supermart_user`, and added `x-forwarded-proto` + `Partitioned` cookie flags. | Fixed |
| BUG-06 | Medium | `server.ts`, `src/components/OsmMapPicker.tsx` | `sanitizeImageValue` accepted internal/metadata/loopback HTTP URLs and unsafe non-HTTP strings; `OsmMapPicker` interpolated pin labels directly into Leaflet HTML; 500 handlers returned raw `err.message` in production. | Blocked private/loopback/link-local hosts, embedded URL credentials, and invalid schemes with HTTP `400`; added HTML escaping in `escapePinHtml()`; added HSTS / `X-DNS-Prefetch-Control` / `Permissions-Policy`; masked production 500 error text via `safeServerError()`. | Fixed |
| BUG-07 | Low | `src/components/CustomerApp.tsx`, `src/components/StoreOwnerDashboard.tsx` | Profile shortcut label still read `"View Order History & Delivery OTP"` despite rider/delivery OTP retirement; Store Owner Inventory tab had no quick Low Stock (`1–10`) alert banner or filter chip. | Updated label to `"View Order History & Pickup Code"` and added Low Stock warning banner, badge, and filter tab (`0 < stock <= 10`) in Store Owner Inventory. | Fixed |

---

## Preserved Marketplace Rules & Retired Modules Confirmed Intact
- **Central Warehouse & Platform Riders (`410 Gone`)**: All legacy rider, supplier, purchase order, central product mutation, central delivery slot, and warehouse fee routes remain retired (`HTTP 410`).
- **Free Launch Lock**: `monetization_enabled`, `subscriptions_enabled`, `featured_stores_enabled`, `store_ads_enabled`, `admob_enabled`, and `adsense_enabled` remain enforced `false` on both backend settings and Admin UI.
- **Single-Store Cart & Server-Side Order Calculations**: Enforced end-to-end inside `src/App.tsx` and Firestore transactions in `server.ts` / `src/server/firestoreDb.ts`.

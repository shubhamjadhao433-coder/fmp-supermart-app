# FMP Supermart — Production Deployment Guide

**Architecture:** React 19 SPA (Vite + Workbox PWA) + Express API (`server.ts` / `dist/server.js`) + Google Cloud Firestore  
**Service Area:** Karanja Lad, Maharashtra (`444105`)

---

## 1. Environment Variables

Configure environment secrets in your hosting provider (never commit `.env` files with real credentials). Reference template: `.env.example`.

| Variable | Required In Production | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. Enables strict `JWT_SECRET` enforcement, strict CORS/CSRF enforcement, HTTPS `Secure; SameSite=None; Partitioned` cookies, HSTS, and masked 500 error messages. |
| `PORT` | Optional (Node host) | HTTP port for `node dist/server.js` (defaults to `3000` when unset). |
| `JWT_SECRET` | **Yes** | Random secret **at least 32 characters long** (`openssl rand -hex 32`). Server refuses to start in production with missing, short, or placeholder secrets. |
| `ALLOWED_ORIGINS` | **Recommended** | Comma-separated origin allowlist, e.g. `https://fmpsupermart.in,https://www.fmpsupermart.in`. If omitted in production, server enforces exact same-origin matching against `Host` / `X-Forwarded-Host`. |
| `ALLOW_INSECURE_SEED_DEFAULTS` | **Keep `false`** | Must remain `false` in production so demo credentials and sample accounts are never created. |

---

## 2. Build & Run Commands (Node.js Host)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Type-check and verify build:
   ```bash
   npm run lint
   npm run build
   ```
   - `vite build` generates static frontend & PWA Service Worker artifacts in `dist/`.
   - `esbuild` bundles the Express API server to `dist/server.js`.
3. Verify tests before deploying:
   ```bash
   npm test
   ```
4. Start the production server:
   ```bash
   NODE_ENV=production JWT_SECRET="<32+-char-random-secret>" node dist/server.js
   ```

---

## 3. Vercel Deployment Notes

`vercel.json` rewrites `/api/(.*)` requests to `api/index.ts` (which exports the Express `app` from `server.ts`), while Vite static assets in `dist/` serve the frontend and PWA files:

- Set **Build Command**: `npm run build`
- Set **Output Directory**: `dist`
- Add `NODE_ENV=production`, `JWT_SECRET`, `ALLOWED_ORIGINS`, and `ALLOW_INSECURE_SEED_DEFAULTS=false` in Vercel Environment Variables.
- Because `server.ts` sets `app.set('trust proxy', 1)`, `X-Forwarded-Proto` and `X-Forwarded-For` from Vercel/reverse proxies are respected for rate limiting and HTTPS cookie attributes.

---

## 4. Firebase & Firestore Security Setup (Critical Before Go-Live)

`firestore.rules` enforces zero-trust access control blocking direct client-browser writes across all collections.

**Important Architectural Note:**  
`src/server/firestoreDb.ts` currently connects to Firestore using the `firebase` Web Client SDK rather than `firebase-admin` service-account credentials. Before deploying the locked-down `firestore.rules` to a public production Firebase project:

1. Create a Google Cloud / Firebase service account with **Cloud Datastore User** / Firestore access and store credentials securely in server environment secrets (never in `VITE_*` or client code).
2. Migrate `src/server/firestoreDb.ts` from `firebase/firestore` to `firebase-admin/firestore` (note `firebase-admin` is already declared in `package.json`).
3. Deploy `firestore.rules`:
   ```bash
   firebase deploy --only firestore:rules
   ```
4. Never ship `firebase-applet-config.json` without zero-trust `firestore.rules` active, because Firebase web API keys are public client identifiers rather than server-side authorization secrets.

---

## 5. Pre-Launch Checklist

- [ ] Strong `JWT_SECRET` (32+ chars) configured in production secrets manager.
- [ ] `ALLOW_INSECURE_SEED_DEFAULTS=false` confirmed and any test store/demo users removed or disabled in Firestore.
- [ ] Real Super Admin account password updated cleanly via secure admin credentials.
- [ ] `ALLOWED_ORIGINS` set to exact production HTTPS domain(s).
- [ ] `src/server/firestoreDb.ts` switched to `firebase-admin` before deploying `firestore.rules`.
- [ ] Run `npm run lint && npm run build && npm test` cleanly on target commit.

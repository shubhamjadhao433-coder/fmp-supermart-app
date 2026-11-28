# Security Summary

**Reviewed Files**: 14  
**Issues Resolved**: 6

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Legacy Account Snapshot | `data/fmp_db_state.json` | 1 | An unused JSON snapshot from an older file store remained on disk with customer phone numbers, addresses, order history, and hashed passwords. | High | Fixed | Replaced the file with an empty schema skeleton containing zero user or order records and added an automated test check. |
| Production Cross-Origin & Cookie CSRF Controls | `server.ts` | 168 | When `ALLOWED_ORIGINS` was left empty in production, cross-origin requests and cookie-authenticated state-changing calls were not restricted to the app's own origin. | High | Fixed | Enforced `ALLOWED_ORIGINS` or exact same-origin (`Host` / `X-Forwarded-Host`) checks in production and returned structured JSON `403` rejections. |
| Missing Request Rate Limiting | `server.ts` | 109 | Authentication, store registration, password reset requests, checkout creation, and location search endpoints allowed unlimited repeated requests from a single IP. | High | Fixed | Configured `trust proxy` and added sliding-window IP rate limiters returning HTTP `429` with `Retry-After` headers. |
| Browser Token Storage & Session Cookie Attributes | `src/services/api.ts`, `server.ts` | 25, 93 | Auth tokens were saved into `localStorage` and `sessionStorage`, and auth cookies lacked `x-forwarded-proto` HTTPS detection and `Partitioned` attributes. | High | Fixed | Kept bearer tokens strictly in JavaScript memory while purging legacy Web Storage keys, relying on `HttpOnly` cookies across reloads with proxy-aware `Secure; SameSite=None; Partitioned` flags. |
| Unsafe External Image URLs & Map Pin HTML | `server.ts`, `src/components/OsmMapPicker.tsx` | 217, 36 | Image URL filtering did not block private/loopback/metadata network hosts or unsafe schemes, and Leaflet map pin labels were placed inside an HTML string without escaping. | Medium | Fixed | Added URL parsing to block internal/private/loopback/metadata hosts, credentials, and disallowed schemes with HTTP `400`, and HTML-escaped map pin labels before rendering. |
| Verbose Error Responses & Security Headers | `server.ts` | 163 | Production 500 error handlers forwarded raw internal error text and omitted `Strict-Transport-Security`, `X-DNS-Prefetch-Control`, and `Permissions-Policy`. | Medium | Fixed | Masked unexpected 500 error details in production using `safeServerError()` and added baseline security headers. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Signing Key & Session Invalidation | `src/server/auth.ts` | Requires a strong `JWT_SECRET` (32+ chars) in production and rejects tokens issued prior to any administrative password reset (`password_changed_at`). |
| Role & Store Ownership Isolation | `server.ts` | Verifies authenticated user identity from Firestore on every protected route, enforces role checks (`admin`, `store_owner`), scopes store-owner updates to their own `store_id`, and restricts Admin product moderation routes (`PUT /api/admin/products/:id/status`, `DELETE /api/admin/products/:id`) strictly to `admin`. |
| Server-Side Pricing & Order Invariants | `server.ts`, `src/server/firestoreDb.ts` | Computes item prices, savings, store delivery fees, free pickup charges (`0`), stock/availability checks (`is_active !== false && stock > 0`), and 6-digit pickup verification codes inside atomic Firestore transactions. |
| Retired Central Warehouse & Rider Routes | `server.ts` | Permanently blocks legacy warehouse stock, rider, supplier, and fee calculation endpoints with `410 Gone`. |
| Production Static Asset & SEO Routes | `server.ts` | Dynamically resolves built frontend assets (`dist/index.html`) and PWA assets (`public/`) when running bundled `dist/server.js`, and serves crawler-safe `/robots.txt` (disallowing `/api/` and `/admin`) and `/sitemap.xml`. |
| Direct Database Rules Model | `firestore.rules` | Denies direct browser writes to all collections (`allow write: if false`). *(Follow-up: migrate `src/server/firestoreDb.ts` from Firebase Web SDK to `firebase-admin/firestore` before deploying these rules in production.)* |

---

## PoC Verification

### Unsafe External Image URLs on Store Product Creation
#### Summary
| Field | Value |
|---|---|
| Issue Type | Internal Network / Unsafe URL Scheme Acceptance |
| Impact | Medium |
| Affected File | `server.ts:217` (`sanitizeImageValue`) |
| Test Scenario | Send `POST /api/store-owner/products` with `image_url: "http://169.254.169.254/latest/meta-data/"`, `"http://127.0.0.1:3000/api/admin/stats"`, `"http://localhost:8080/secret.png"`, and `"javascript:alert(1)"`. |

#### How It Was Fixed
`sanitizeImageValue` validates image strings before persistence: inline images must match an explicit JPEG/PNG/WebP data-URI pattern under size limits, and remote URLs are parsed with `new URL()` to ensure only `http:` or `https:` schemes without embedded credentials are permitted and that loopback, private IPv4/IPv6 ranges, link-local metadata hosts (`169.254.*`), and `.local`/`.internal` hostnames are rejected with an explicit error.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Authenticated store-owner request enters `POST /api/store-owner/products` (`server.ts:2412`) with `image_url: "http://169.254.169.254/latest/meta-data/"`. | Request reaches `sanitizeImageValue(image_url)` (`server.ts:2476`). |
| 2 | `sanitizeImageValue` parses the URL (`server.ts:231`) and checks `isDisallowedImageHost("169.254.169.254")` (`server.ts:199`). | Matches link-local range (`a === 169 && b === 254`) and throws `'Image URL host is not allowed.'`. |
| 3 | Route catch block intercepts the validation error (`server.ts:2501`). | **Handled Safely** — returns HTTP `400` without storing or fetching the URL (verified in Test 50). |

#### Conclusion
**Fix Verified** - Unsafe URL schemes and internal/metadata hosts are rejected at validation time with HTTP `400` before reaching product or store documents.

---

### Unescaped Map Pin Label Rendering
#### Summary
| Field | Value |
|---|---|
| Issue Type | Unescaped HTML Interpolation |
| Impact | Medium |
| Affected File | `src/components/OsmMapPicker.tsx:45` (`createPinIcon`) |
| Test Scenario | Pass a store name containing `<img src=x onerror=alert(1)>` as `pinLabel` or `warehouseLabel` into `OsmMapPicker`. |

#### How It Was Fixed
Added `escapePinHtml()` to encode `&`, `<`, `>`, `"`, and `'` as HTML entities before interpolating the label into the Leaflet `divIcon` markup string.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Store or map label containing `<img src=x onerror=alert(1)>` is passed to `createPinIcon(color, label)` (`src/components/OsmMapPicker.tsx:45`). | Input enters pin icon builder. |
| 2 | `escapePinHtml(label)` converts `<` to `&lt;`, `>` to `&gt;`, and quotes to entities (`src/components/OsmMapPicker.tsx:36`). | Markup characters are neutralized as inert text. |
| 3 | Leaflet inserts the icon markup into the map overlay (`src/components/OsmMapPicker.tsx:60`). | **Handled Safely** — the label displays literally as plain text with zero script execution. |

#### Conclusion
**Fix Verified** - HTML metacharacters in map pin labels are escaped before DOM insertion, preventing injected markup from executing.

---

### Unthrottled Password Reset & Auth Endpoint Flooding
#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Request Rate Limiting |
| Impact | High |
| Affected File | `server.ts:109` (`createRateLimiter`) |
| Test Scenario | Send 8 rapid `POST /api/auth/forgot-password-request` requests from the same client IP within 15 minutes. |

#### How It Was Fixed
Enabled `app.set('trust proxy', 1)` and attached sliding-window IP rate limiters to login, registration, store onboarding, password reset requests, order placement, and location lookup routes.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Consecutive requests arrive at `POST /api/auth/forgot-password-request` (`server.ts:588`) through `forgotPasswordLimiter`. | Limiter records timestamps per client IP. |
| 2 | On the 7th request within 15 minutes (`recent.length >= 6`, `server.ts:115`), the limiter computes remaining window time (`Retry-After`). | Exceeds threshold and skips route handler. |
| 3 | Limiter sends JSON error response (`server.ts:117`). | **Handled Safely** — returns HTTP `429` with `Retry-After` header (verified in Test 50). |

#### Conclusion
**Fix Verified** - Repeated bursts from a single IP are throttled with HTTP `429` and a `Retry-After` header before touching database or external API resources.

# StockFlow MVP

A minimal multi-tenant SaaS inventory management app, built for the "Phase 1 – 6-Hour MVP" PRD.

Users sign up with an organization, manage products (name, SKU, quantity, prices), adjust stock, and see a dashboard with an inventory summary and low-stock items. All data is scoped to the user's organization.

**Live demo:** https://stockflow-mvp-two-kappa.vercel.app

## Features (mapped to the PRD)

| PRD item | What's built |
| --- | --- |
| FR-1 Signup & Login | Email + password + organization name signup, login, logout. Passwords hashed with bcrypt. Basic validation (email format, 8+ char password, matching confirmation). |
| FR-2 Organization context | Signup creates an Organization linked to the user. Every product query filters by `organization_id`, so one org can never read or change another org's data. |
| FR-3 Product model | ID, organization ID, name, SKU (unique per org, case-insensitive), description, quantity on hand, cost price, selling price, low-stock threshold, created/updated timestamps, `last_updated_by`. |
| FR-4 Product CRUD | Create/edit form, product list (name, SKU, quantity, low-stock indicator, selling price), hard delete with a confirm dialog. |
| FR-5 Simple stock updates | Edit quantity in the form, or use the inline "Adjust stock" control (+/- N with an optional note). Stock can't go below zero. `last_updated_by` and timestamp are recorded. |
| FR-6 Dashboard | Total products, total units on hand, and a low-stock table (name, SKU, quantity, threshold). Low stock = quantity ≤ product threshold, or the org default if empty. |
| FR-7 Settings | Default low-stock threshold per organization (starts at 5). |
| Screen list | Login, Signup, Dashboard, Product list with search by name/SKU (server-side + instant client-side filter), Create/Edit form, Settings. |

Extras: CSRF protection on every write, signed HTTP-only session cookies, field-level validation messages, toasts, loading states, responsive layout with a mobile menu, a 404 page, a health check at `/api/health`, and an automated end-to-end test suite.

## Tech stack

- **Frontend:** plain HTML, CSS and vanilla JavaScript (no framework, no build step) in `public/`
- **Backend:** Node.js + Express JSON API under `/api`
- **Database:** PostgreSQL. Hosted Postgres (Neon) in production via `DATABASE_URL`; locally an embedded Postgres ([PGlite](https://pglite.dev)) so there's nothing to install
- **Auth:** Session cookies (`cookie-session`, signed, HTTP-only) + `bcryptjs`
- **Hosting:** Vercel (static files on the CDN, Express API as a serverless function)

Each page's JavaScript calls the API with `fetch` and renders the result. Sessions live in a signed cookie, so the API is stateless and works across serverless instances.

## API

All endpoints return JSON. Writes must send the header `X-Requested-With: StockFlow` (CSRF guard). Everything except signup/login needs a session.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` | Create user + organization, start session |
| POST | `/api/auth/login` | Start session |
| POST | `/api/auth/logout` | End session |
| GET | `/api/me` | Current user and organization |
| GET | `/api/dashboard` | Totals and low-stock items |
| GET | `/api/products?q=` | List / search products |
| POST | `/api/products` | Create product |
| GET | `/api/products/:id` | Get one product |
| PUT | `/api/products/:id` | Update product |
| POST | `/api/products/:id/adjust` | Change stock by `delta` (with optional `note`) |
| DELETE | `/api/products/:id` | Delete product |
| GET / PUT | `/api/settings` | Read / update default low-stock threshold |

Validation errors come back as `422` with `{ "error": "...", "errors": { "field": "message" } }`.

## Running locally

Requires **Node.js 24**.

```bash
npm install
npm start
```

Open http://localhost:3000 and sign up. Without `DATABASE_URL`, data is stored by the embedded Postgres in `data/pgdata/`. To use a real Postgres locally, set `DATABASE_URL` before `npm start`.

For auto-reload while developing, use `npm run dev`.

## Tests

```bash
npm test
```

The tests run the real app against an in-memory database and cover page serving, signup/login/logout, validation, CSRF rejection, product CRUD, stock adjustment (including the below-zero guard), low-stock logic with per-product and default thresholds, settings, and tenant isolation (org B gets 404 on org A's products and can reuse the same SKU).

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SESSION_SECRET` | In production | dev value | Long random string used to sign session cookies. The app refuses to start in production without it. |
| `DATABASE_URL` | On Vercel | embedded Postgres | Postgres connection string (`POSTGRES_URL` also works). Set automatically when you connect Neon in Vercel. |
| `PORT` | No | `3000` | Local / traditional hosting only. |
| `NODE_ENV` | No | | `production` enables secure cookies (Vercel sets this). |

The tables are created automatically on first start.

## Deploying (Vercel)

1. Import the GitHub repo in Vercel (framework is detected as **Express**). `src/app.js` becomes the API function; `public/` is served from the CDN.
2. In the project, open **Storage → Create Database → Neon (Postgres)** and connect it. This adds `DATABASE_URL`.
3. Add `SESSION_SECRET` under **Settings → Environment Variables**.
4. Redeploy. Check `https://<your-app>.vercel.app/api/health` → `{"ok":true,"db":"postgres"}`.

`render.yaml` is also included if you prefer Render (it uses the embedded Postgres, which resets on redeploys on the free plan).

## Project structure

```
public/                 # frontend (served as static files)
  index.html            # dashboard
  login.html
  signup.html
  products.html         # product list, search, stock adjust, delete
  product.html          # add product, or edit with ?id=
  settings.html
  404.html
  css/styles.css
  js/app.js             # shared: API calls, layout/sidebar, icons, toasts, form errors
  js/dashboard.js  js/products.js  js/product.js  js/settings.js  js/login.js  js/signup.js
src/                    # backend
  server.js             # starts the HTTP server locally
  app.js                # JSON API, auth, tenant scoping (Vercel entry point)
  db.js                 # Postgres schema + driver (pg or embedded PGlite)
  validate.js           # input validation
test/                   # end-to-end tests (node:test)
```

## Out of scope (per PRD)

Multi-warehouse, variants, channel integrations, orders, purchase orders, email notifications, CSV import, public API, roles/invites, audit logs, billing, password reset.

## Possible next steps

- Stock movement history table (each adjustment as a row)
- Postgres for production + migrations
- Password reset and multi-user orgs with roles
- Pagination on the product list

# Help PR — Backend (Staging)

Node.js / Express API for **Help PR**, a franchise-based home-services marketplace. Partners deliver services; franchises operate territories; platform staff manage global catalog and operations.

## Quick start

```bash
npm install
# Configure .env (see Environment variables)
npm run dev    # nodemon — http://localhost:5001
# or
npm start
```

Health check: `GET /health` → `{ "status": "OK" }`

## Documentation

| Document | Description |
|----------|-------------|
| **[docs/PROJECT_FLOW_AND_ROLES.md](docs/PROJECT_FLOW_AND_ROLES.md)** | **End-to-end flows, user roles, and access matrix** |
| [docs/ORDER_MODULE_FRONTEND.md](docs/ORDER_MODULE_FRONTEND.md) | Orders, payments, pricing |
| [docs/PARTNER_POST_FRONTEND.md](docs/PARTNER_POST_FRONTEND.md) | Partner portfolio posts, feed, like, share, report |
| [docs/REFUND_API.md](docs/REFUND_API.md) | Refunds |
| [postman/README.md](postman/README.md) | Postman collections and test order |

## Tech stack

- **Express 4** + **MongoDB** (Mongoose)
- **JWT** authentication
- **AWS Lambda** (`aws-serverless-express`) for APIs; **Chat Service** on VPS for messaging
- **Razorpay**, **Firebase** (push), **S3** (uploads)

## User types (`user.type`)

| Type | Role |
|------|------|
| 1 | Franchise Admin |
| 2 | Partner (service provider) |
| 3 | Employee |
| 4 | Customer |
| 5 | Super Admin |
| 6 | Staff |

See [docs/PROJECT_FLOW_AND_ROLES.md](docs/PROJECT_FLOW_AND_ROLES.md) for what each role can do.

## Main API prefixes

| Prefix | Purpose |
|--------|---------|
| `/api/auth` | Web login, logout, forgot password |
| `/api/otp` | Customer phone OTP |
| `/api/user` | User CRUD, partner registration (web) |
| `/api/franchise`, `/api/franchise-category`, `/api/franchise-service` | Franchise operations |
| `/api/category`, `/api/service` | Global catalog |
| `/api/partner_category`, `/api/partner_service` | Partner catalog (web) |
| `/api/quote`, `/api/order` | Sales pipeline |
| `/api/order-payments`, `/api/order-additional-charges` | Order financials |
| `/api/refund`, `/api/partner_payout` | Refunds and partner remittance |
| `/api/mobile/partner` | Partner mobile app |
| Chat (REST + Socket.IO) | **help-pr-chat-service** on VPS (`CHAT_SERVICE_BASE_URL`) |

Auth header for protected routes: `Authorization: Bearer <jwt>`

## Project layout

```
config/          Database connection
controllers/     HTTP handlers
middleware/      Auth, validation, role checks
models/          Mongoose schemas
routes/          Express routers
services/        Business logic
utils/           Shared helpers (franchise scope, pricing, etc.)
src/modules/notifications  In-app notifications
docs/            Integration and flow documentation
postman/         API collections
server.js        App entry (local server + Lambda handler)
```

## Environment variables

Typical variables (set in `.env` or Lambda console):

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret
- `PORT` — Local port (default `5001`)
- `MOBILE_APP_DEEP_LINK_BASE` — Base URL for post share deep links (default `helppr://post`)
- AWS / S3, Razorpay, Firebase, mail — per integration

**Chat Service on VPS** (when using remote chat):

- `CHAT_SERVICE_ENABLED` — `true` to provision chats via VPS HTTP API
- `CHAT_SERVICE_BASE_URL` — e.g. `http://13.201.79.72:5001`
- `CHAT_SERVICE_INTERNAL_API_KEY` — shared secret with VPS (header `X-Internal-Api-Key`)

Deploy steps: **[docs/LAMBDA_VPS_DEPLOY.md](docs/LAMBDA_VPS_DEPLOY.md)**

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with nodemon |
| `npm start` | Start with node |
| `npm run sync:catalog-mappings` | Sync global catalog to franchise mappings |
| `npm run verify:order-pricing` | Verify order pricing script |

## License

ISC

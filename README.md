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
| [docs/REFUND_API.md](docs/REFUND_API.md) | Refunds |
| [postman/README.md](postman/README.md) | Postman collections and test order |

## Tech stack

- **Express 4** + **MongoDB** (Mongoose)
- **JWT** authentication
- **AWS Lambda** (`aws-serverless-express`) or local HTTP + **Socket.IO** (chat)
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
| `/api/chat` | Messaging |

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
src/modules/chat Chat module (routes + socket)
docs/            Integration and flow documentation
postman/         API collections
server.js        App entry (local server + Lambda handler)
```

## Environment variables

Typical variables (set in `.env`):

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — JWT signing secret
- `PORT` — Local port (default `5001`)
- AWS / S3, Razorpay, Firebase, mail — per integration

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start with nodemon |
| `npm start` | Start with node |
| `npm run sync:catalog-mappings` | Sync global catalog to franchise mappings |
| `npm run verify:order-pricing` | Verify order pricing script |

## License

ISC

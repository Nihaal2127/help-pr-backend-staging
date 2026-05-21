# Archived: legacy `financial_order` module

**Archived:** May 2026  
**Reason:** Financial — Order Payments is derived from the `order` collection; a separate `financial_order` table is no longer used.

## Active replacement

| Old | New |
|-----|-----|
| `GET /api/financial-order/getAll` | `GET /api/order/financial-payments/getAll` |
| `GET /api/financial-order/get/:id` | `GET /api/order/financial-payments/get/:id` |
| `POST /api/financial-order/create` | `POST /api/order/create` + `order_payments` |
| Manual financial rows | `order` rollups + `order_payment` lines |

**Docs:** `docs/FINANCIAL_ORDER_PAYMENTS_API.md`

## Contents of this folder

Reference-only snapshot (not mounted in `server.js`):

- `models/financial_order.js` — Mongoose schema
- `routes/financial_order_routes.js` — Express routes
- `controllers/financial_order_controller.js`
- `services/financial_order_service.js` — Last thin delegate before archive
- `middleware/financial_order_middleware.js` — Create/update validation
- `helper/getFinancialOrderUniqueId.js` — ID helper removed from active `helper/id_generator.js`

## Database

Existing `financial_order` documents in MongoDB are **not** deleted by this archive. Drop or migrate that collection separately if no longer needed.

`partner_wallet_ledger.financial_order_id` remains on the schema for historical ledger rows.

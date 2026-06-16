# Partner financial & wallet — mobile frontend guide

**Date:** June 2026  
**Base path:** `/api/mobile/partner`  
**Postman:** `postman/Help-PR-Mobile-APIs.postman_collection.json` → **Partner → Financial & Wallet**  
**Backend:** `services/order_financial_payments_service.js` (partner list), `services/mobile/partner/wallet_service.js`

---

## 1. Overview

Partners can view the same **order-derived** earnings data as the admin Financial — Order Payments grid, scoped to their own orders, plus **wallet balance** and **ledger transactions**.

| Screen | API |
|--------|-----|
| Earnings / pending per order | `GET /financial-payments` |
| Order earnings detail | `GET /financial-payments/:orderId` |
| Wallet balance + period summary | `GET /wallet` |
| Wallet transaction history | `GET /wallet/transactions` |

**Auth:** Partner JWT (`user.type === 2`). No `partner_id` query — always the logged-in partner.

**Admin equivalent:** `GET /api/order/financial-payments/getAll` (see `docs/FINANCIAL_ORDER_PAYMENTS_API.md`).

---

## 2. Order payments — `GET /financial-payments`

Paginated list of the partner’s orders with earning, paid, and pending amounts.

### Query parameters

| Param | Description |
|-------|-------------|
| `page` | Default `1` |
| `limit` | Default `10` |
| `from_date`, `to_date` | Order schedule / `order_date` (same rules as admin financial list) |
| `order_status` | `in_progress` \| `completed` \| `in-progress` \| `cancelled` \| `refunded` |
| `partner_payment_status` | `unpaid` \| `partially_paid` \| `paid` |
| `search` | `order_unique_id`, customer name, service name |
| `sort_by` | `user_name`, `service_name`, `service_date`, `created_at`, `order_date`, `total_price`, `order_unique_id` |
| `sort_order` | `asc` \| `desc` |

### Example response

```json
{
  "success": true,
  "status": 200,
  "message": "Partner order payments fetched successfully.",
  "source": "order",
  "totalItems": 12,
  "totalPages": 2,
  "currentPage": 1,
  "totals": {
    "total_orders": 12,
    "total_partner_amount": 45000,
    "total_paid_to_partner": 20000,
    "total_pending_to_partner": 25000,
    "total_completed_orders": 8,
    "total_in_progress_orders": 4
  },
  "records": [
    {
      "sr_no": 1,
      "_id": "664a1b2c3d4e5f6789012345",
      "order_id": "664a1b2c3d4e5f6789012345",
      "order_unique_id": "ORD-00042",
      "user_name": "Jane Customer",
      "service_name": "Home Cleaning",
      "service_date": "2026-06-01",
      "total_earning": 2700,
      "paid_amount": 1000,
      "pending_amount": 1700,
      "payment_status": "partially_paid",
      "order_status": "in_progress",
      "order_status_canonical": "in-progress",
      "created_at": "2026-05-10T08:00:00.000Z",
      "updated_at": "2026-05-15T12:00:00.000Z"
    }
  ]
}
```

### Field mapping (admin → mobile)

| Admin (`financial-payments/getAll`) | Mobile partner |
|-------------------------------------|----------------|
| `total_partner_amount` | `total_earning` |
| `paid_to_partner` | `paid_amount` |
| `pending_to_partner` | `pending_amount` |
| `partner_payment_status` | `payment_status` |

`totals` applies to **all rows matching filters**, not only the current page.

Cancelled / refunded orders: `pending_amount` is **0** (same as admin).

---

## 3. Order payment detail — `GET /financial-payments/:orderId`

`:orderId` = order Mongo `_id`. Returns the list-row summary plus payment line items. **404** if the order is not assigned to this partner.

### Response fields

| Field | Description |
|-------|-------------|
| `record` | Same shape as one list row (`total_earning`, `paid_amount`, `pending_amount`, …) |
| `partner_summary` | Earnings breakdown (`service_earning`, `additional_charges_earning`, customer payment rollup) — same as order detail |
| `order_payments` | All `order_payment` rows for this order (customer + partner), newest first |

### Example response

```json
{
  "success": true,
  "status": 200,
  "message": "Partner order payment fetched successfully.",
  "source": "order",
  "record": {
    "order_unique_id": "ORD-00042",
    "total_earning": 2700,
    "paid_amount": 1000,
    "pending_amount": 1700,
    "payment_status": "partially_paid",
    "order_status": "in_progress"
  },
  "partner_summary": {
    "service_earning": 2200,
    "additional_charges_earning": 500,
    "total_earning": 2700,
    "paid_amount": 1000,
    "due_amount": 1700,
    "payment_status": "partially_paid",
    "customer_order_total": 3500,
    "customer_due_amount": 1500,
    "customer_payment_status": "partially_paid"
  },
  "order_payments": [
    {
      "_id": "...",
      "order_id": "...",
      "payer_type": "customer",
      "amount": 2000,
      "payment_method": "upi",
      "status": "completed",
      "paid_at": "2026-05-12T10:00:00.000Z",
      "created_at": "2026-05-12T10:00:00.000Z"
    },
    {
      "_id": "...",
      "order_id": "...",
      "payer_type": "partner",
      "amount": 1000,
      "payment_method": "bank_transfer",
      "status": "completed",
      "paid_at": "2026-05-15T12:00:00.000Z",
      "created_at": "2026-05-15T12:00:00.000Z"
    }
  ]
}
```

| `order_payments[].payer_type` | Meaning |
|-------------------------------|---------|
| `customer` | Customer payment toward the order total |
| `partner` | Payout / payment recorded for the partner |

---

## 4. Wallet summary — `GET /wallet`

Current wallet balance plus optional **period totals** when date filters are set.

### Query parameters

| Param | Description |
|-------|-------------|
| `from_date`, `to_date` | Filter period totals on ledger `date` |
| `transaction_type` | Optional `credit` \| `debit` for period totals |

### Example response

```json
{
  "success": true,
  "status": 200,
  "message": "Partner wallet fetched successfully.",
  "data": {
    "wallet_balance": 4500.5,
    "partner": {
      "partner_id": "PRT-1024",
      "partner_name": "Raj Partner"
    },
    "totals": {
      "transaction_count": 5,
      "total_credit": 6000,
      "total_debit": 1500,
      "net_change": 4500
    }
  }
}
```

| Field | Meaning |
|-------|---------|
| `wallet_balance` | Current balance (all-time credits − debits) |
| `totals` | Aggregates for the filtered ledger rows (or all rows if no dates) |

---

## 5. Wallet transactions — `GET /wallet/transactions`

Paginated ledger (credits from completed partner order payments, debits from admin payouts / refunds / subscription changes).

### Query parameters

| Param | Description |
|-------|-------------|
| `page`, `limit` | Default `1`, `10`; max `100` |
| `from_date`, `to_date` | Ledger `date` |
| `transaction_type` | `credit` \| `debit` |
| `search` | `description`, `order_unique_id`, `payment_method` |

### Example response

```json
{
  "success": true,
  "status": 200,
  "message": "Partner wallet transactions fetched successfully.",
  "data": {
    "wallet_balance": 4500.5,
    "partner": {
      "partner_id": "PRT-1024",
      "partner_name": "Raj Partner"
    },
    "totals": {
      "transaction_count": 2,
      "total_credit": 1500,
      "total_debit": 0,
      "net_change": 1500
    },
    "records": [
      {
        "_id": "...",
        "date": "2026-05-12",
        "transaction_type": "credit",
        "order_id": "...",
        "order_unique_id": "ORD-9001",
        "order_payment_id": "...",
        "description": "Order ORD-9001 — partner earning",
        "payment_method": null,
        "amount": 1500
      }
    ],
    "totalPages": 1,
    "totalItems": 2,
    "currentPage": 1,
    "limit": 10
  }
}
```

---

## 6. Recommended UI flow

```text
[Earnings screen]
  GET /financial-payments?from_date=&to_date=
  → show totals banner + list rows

[Order tap]
  GET /financial-payments/:orderId
  → show record + partner_summary + order_payments[]

[Wallet screen]
  GET /wallet?from_date=&to_date=
  → show wallet_balance + period totals

[Transaction list]
  GET /wallet/transactions?page=1&from_date=&to_date=
```

---

## 7. Related docs

- Admin financial grid: `docs/FINANCIAL_ORDER_PAYMENTS_API.md`
- Partner wallet (admin): `docs/PARTNER_PAYOUT_FRONTEND.md`
- Order detail earnings block: `docs/PARTNER_ORDER_WORK_FRONTEND.md` (`partner_summary`)
- Subscription wallet balance: `docs/SUBSCRIPTION_CHANGE_FRONTEND.md`

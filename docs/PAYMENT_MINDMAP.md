# Here is the complete payment map for this project, as a structured mind map.

## Root: HelpPR money

```text
                      HELPPR PAYMENTS
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
MONEY IN                MONEY HELD              MONEY OUT
(customer /              (ledgers)              (partner /
 partner sub)                                   refunds)
```

Only Razorpay is a real gateway. Everything else is recorded in MongoDB.

---

## 1. Two kinds of “payment”

```text
PAYMENT
├── A. GATEWAY (Razorpay)     → real money moves
│     method stored as: "online"
│     always starts PENDING
│     completes on webhook OR payment-status poll
│
└── B. OFFLINE (recorded)     → staff/customer says “we collected it”
      cash | upi | card | bank_transfer | other
      usually saved as COMPLETED immediately
      no Payment Link
```

Razorpay is used for three purposes only:

```text
RAZORPAY PAYMENT LINKS
├── order              → customer pays an order
├── quote_deposit      → customer pays deposit; order created after pay
└── subscription_change → partner upgrades plan
```

Not Razorpay: partner payout to bank, extra-charge labels, service “per hour / per day”.

---

## 2. How an order’s price is born

```text
SERVICE CATALOG
  tax %
  commission %
  minimum deposit %
        │
        ▼
QUOTE / ORDER CREATE
        │
        ├─ partner charge     e.g. ₹500
        ├─ commission         8% → ₹40     (platform)
        ├─ sub_total          ₹540
        ├─ tax                10% → ₹54
        └─ customer total     ₹594
              │
              ├─ minimum_deposit  5% of 594 → ₹29.70
              └─ partner_earning  ₹500  (no tax/commission)
```

Customer owes ₹594. Partner is owed ₹500. Platform keeps commission + tax treatment on the books.

---

## 3. Mind map of every payment path

```text
PAYMENTS
│
├── 3.1 CUSTOMER → ORDER
│     │
│     ├── Offline
│     │     POST /api/order-payments/create
│     │       payer_type: customer
│     │       method: cash/upi/card/...
│     │       status: completed   ← saved at once
│     │     OR mobile:
│     │       POST /api/mobile/user/orders/:id/payments
│     │
│     └── Online (Razorpay)  ★ main gateway flow
│           POST .../create  { payment_method: "online", amount: 500 }
│                 │
│                 ├─ 1. order_payment  PENDING ₹500
│                 ├─ 2. Razorpay Payment Link  plink_xxx
│                 ├─ 3. 202 + payment_url
│                 ├─ 4. Customer pays on Razorpay
│                 ├─ 5a. Webhook payment_link.paid
│                 │       POST /api/razorpay/razorpayWebhook
│                 └─ 5b. OR poll GET .../payment-status/:id
│                           (backend asks Razorpay: is link paid?)
│                 │
│                 └─ 6. PENDING → COMPLETED
│                       order rollup updates
│                       gateway_payment audit row
│
├── 3.2 CUSTOMER → QUOTE DEPOSIT
│     POST /api/mobile/user/quotes/:id/convert-to-order
│       payment_method: online
│           │
│           ├─ order_payment with quote_id, NO order_id yet
│           ├─ PENDING + Razorpay link (min deposit)
│           ├─ cannot cancel quote while pending
│           │
│           └─ on paid:
│                 quote still valid  → CREATE ORDER, attach payment
│                 quote invalid      → auto Razorpay refund
│
├── 3.3 ADMIN CREATES ORDER + FULL CHECKOUT
│     POST /api/order/create
│       payment_mode_id: "2"
│           → order saved, then same online flow for total_price
│
├── 3.4 ADDITIONAL CHARGES
│     POST /api/order-additional-charges
│           → increases total_price / customer_due
│           → payment_method on the charge is a LABEL only
│           → customer pays extra via 3.1 order payments
│
├── 3.5 PARTNER SUBSCRIPTION
│     POST /api/mobile/partner/subscription/change
│       wallet + cash + online_amount
│           │
│           ├─ wallet debit immediately (if used)
│           ├─ Razorpay link if online_amount > 0
│           └─ webhook → plan applied
│                 (NOT an order_payment row)
│
├── 3.6 PARTNER EARNING (wallet credit)
│     POST /api/order-payments/create
│       payer_type: partner, status: completed
│           → partner_wallet_ledger CREDIT
│           → capped by customer_net_paid and partner_earning
│
├── 3.7 PARTNER PAYOUT (wallet debit)  ← NOT Razorpay
│     POST /api/partner_payout/create
│       upi | bank_transfer | cash | cheque
│           → staff sends money outside the app
│           → ledger DEBIT
│
└── 3.8 REFUND (back-office only)
      POST /api/refund/create
           ├─ order_refund (append-only)
           ├─ order_payment status: refunded
           ├─ order → refunded / payment_status refund
           ├─ optional from_partner_wallet → wallet DEBIT
           └─ optional refund_via_razorpay → Razorpay Refund API
```

---

## 4. Online payment — one strip (the core)

```text
YOU                         RAZORPAY                      CUSTOMER
 │                              │                              │
 │  1. Create pending row       │                              │
 │     ₹500 PENDING             │                              │
 │                              │                              │
 │  2. Create Payment Link ────►│  plink_ABC                   │
 │  3. Return payment_url  ◄────│                              │
 │                              │                              │
 │                              │◄──── 4. Opens link, pays ────│
 │                              │     test card / UPI          │
 │                              │                              │
 │  5a. Webhook ◄───────────────│  payment_link.paid           │
 │      HMAC check              │                              │
 │                              │                              │
 │  5b. Poll payment-status     │                              │
 │      GET link from API ─────►│  status: paid?               │
 │                         ◄────│                              │
 │                              │                              │
 │  6. PENDING → COMPLETED      │                              │
 │     order due -= 500         │                              │
 │                              │                              │
 │  Callback page (GET /callback) is only "thank you"          │
 │  It does NOT mark paid.                                     │
```

Why pending first? The customer has not paid yet. The row is the reservation; Razorpay is the cash register; webhook/poll is the receipt.

---

## 5. What gets updated when customer pay completes

```text
completed customer order_payment
        │
        ├── order_payment.status          → completed
        ├── order_payment.paid_at
        ├── gateway_payment               → audit (pay_xxx)
        │
        ├── ORDER rollup
        │     customer_paid_amount      += amount
        │     customer_due_amount       -= amount
        │     payment_status / user_payment_status
        │           unpaid → partially_paid → paid
        │     is_paid = true only when due ≈ 0
        │
        ├── order_service.is_paid         if order fully paid
        ├── partner wallet re-sync        credits capped by net paid
        └── notification                  payment received
```

Your O1017 example:

```text
total 594, paid 0, due 594, unpaid
        pay ₹500 online
total 594, paid 500, due 94, partially_paid, is_paid false
        pay remaining ₹94
total 594, paid 594, due 0, paid, is_paid true
        (only then order can be marked completed)
```

---

## 6. Order as a money box

```text
                ORDER O1017
                total_price ₹594
                      │
      ┌───────────────┼───────────────┐
      ▼               ▼               ▼
CUSTOMER SIDE    PLATFORM SIDE    PARTNER SIDE
paid / due       commission ₹40   earning ₹500
tax ₹54          admin_earning    partner_due
                      │
order_payment        │         order_payment
payer_type:          │         payer_type:
customer             │         partner
      │              │               │
      ▼              │               ▼
customer paid        │         wallet CREDIT
      │              │               │
      ▼              │               ▼
if refund            │         payout DEBIT
(Razorpay or books)  │         (manual bank)
```

Two ledgers on the same order:

| payer_type | Meaning |
|------------|---------|
| customer | Money in from customer |
| partner | HelpPR recorded remittance → wallet credit |

---

## 7. Status mind map

```text
order_payment.status
├── pending     waiting for Razorpay (online only)
├── completed   money counted
├── failed      link expired/cancelled on poll
└── refunded    money given back (books; maybe Razorpay too)
```

```text
order.user_payment_status   (customer rollup)
├── unpaid
├── partially_paid
├── paid                 required before order_status = completed
├── partially_refund
└── refund
```

```text
order.partner_payment_status
├── unpaid
├── partially_paid
└── paid
```

---

## 8. Webhook vs callback vs poll

```text
AFTER CUSTOMER PAYS
        │
        ├── Razorpay Dashboard webhook
        │     POST /api/razorpay/razorpayWebhook
        │     header: x-razorpay-signature
        │     event: payment_link.paid
        │     → finds pending row by plink_id
        │           ├─ quote_id and no order  → deposit flow
        │           ├─ order_id               → order payment
        │           └─ else                   → subscription change
        │
        ├── Poll (Postman / app)
        │     GET /api/order-payments/payment-status/:id
        │     backend fetches plink from Razorpay
        │     if paid → same complete function as webhook
        │
        └── GET /api/razorpay/callback
              HTML “success” page
              DOES NOT update DB
```

Postman folder 31 — Razorpay only documents the webhook URL. Sending {} from Postman fails signature check. Real webhook = Razorpay servers + public HTTPS URL.

---

## 9. Collections (where money lives)

```text
MongoDB
├── order                    totals, due, payment_status
├── order_payment            each installment (customer or partner)
├── order_additional_charge  extras (then pay via order_payment)
├── gateway_payment          Razorpay capture audit + refunded_amount
├── order_refund             admin refund record
├── partner_wallet_ledger    credit (earning) / debit (payout, refund)
├── partner_payout           withdrawal batch
└── partner_subscription_change  plan pay (separate from orders)
```

---

## 10. End-to-end story (one job)

```text
Catalog: Buffet, tax 10%, commission 8%, deposit 5%
                │
Quote accepted  │
                │
Customer pays deposit online (optional)
                │  webhook → ORDER created
                │
ORDER O1017  total 594  due 594  unpaid
                │
Customer pays ₹500 Razorpay
                │  pending → completed
                │  due 94  partially_paid
                │
Customer pays ₹94 (cash or online)
                │  due 0  paid  is_paid true
                │
Staff may add extra charges → due rises again → pay again
                │
Staff records partner payment ₹500
                │  wallet +500
                │
Admin payout ₹500 by bank
                │  wallet -500   (not Razorpay)
                │
If refund needed
                │  books + optional Razorpay refund
                │  optional wallet clawback
```

---

## 11. One-page map

```text
      ┌─────────────────────────────────────┐
      │            CUSTOMER                  │
      │  cash / UPI recorded  OR  Razorpay   │
      └──────────────────┬──────────────────┘
                         │ money in
                         ▼
      ┌─────────────────────────────────────┐
      │  order_payment (customer)            │
      │  pending → completed / refunded      │
      └──────────────────┬──────────────────┘
                         │
      ┌──────────────────┼──────────────────┐
      ▼                  ▼                  ▼
ORDER totals      gateway_payment     QUOTE deposit
due / paid        (Razorpay audit)    then create order
      │
      │ when partner payment recorded
      ▼
order_payment (partner)  →  WALLET credit
      │
      ├── payout (manual)  →  WALLET debit
      └── refund clawback  →  WALLET debit
                         │
                         ▼
      ┌─────────────────────────────────────┐
      │  PARTNER bank (outside Razorpay)     │
      └─────────────────────────────────────┘
```

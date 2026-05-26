# Postman — single collection

Use **one** collection for all APIs:

| File | Purpose |
|------|---------|
| **`Help-PR-All-APIs.postman_collection.json`** | All modules, deduplicated |
| **`Help-PR-Refunds.postman_collection.json`** | **Order refunds** — `/api/refund` (4 requests) |
| **`Help-PR-Financial-Order-Payments.postman_collection.json`** | Financial order payments grid |
| **`Help-PR-Mobile-APIs.postman_collection.json`** | **Mobile only** — `/api/mobile/partner` register & login |

Legacy per-module collections live in **`archive/`** (not for import).

## Setup

1. Postman → **Import** → `Help-PR-All-APIs.postman_collection.json`
2. Collection variables → set **`baseUrl`** (e.g. `http://localhost:5001`)
3. Run **`00 — Auth` → `Login`** — saves JWT to **`accessToken`** and **`token`**
4. Open any folder (Order, Partner payout, Expense, …)

**Partner payout UI:** see `docs/PARTNER_PAYOUT_FRONTEND.md` and folder **37 — Partner payout**.

**Order refunds:** see `docs/REFUND_API.md` and folder **38 — Refunds** (or import `Help-PR-Refunds.postman_collection.json`).

**Partner mobile app (full collection):** **Mobile → Partner**. **Mobile-only collection:** import **`Help-PR-Mobile-APIs.postman_collection.json`** — **Register** / **Login**; **Subscription → List plans**; **Catalog → Categories**; **My services → List** / **Update** (`GET`/`PUT /api/mobile/partner/my-services`).

## Regenerate after API changes

```bash
node postman/merge-all-collections.mjs
node postman/build-mobile-folder.mjs
```

Merge reads `postman/archive/`. **Mobile** (Partner + User subfolders) is rebuilt by `build-mobile-folder.mjs` — run it after merge so partner-related APIs stay grouped under **Mobile → Partner**.

## Folder layout

```
postman/
  Help-PR-All-APIs.postman_collection.json   ← all APIs
  Help-PR-Refunds.postman_collection.json    ← /api/refund only
  Help-PR-Financial-Order-Payments.postman_collection.json
  Help-PR-Mobile-APIs.postman_collection.json   ← mobile routes only
  merge-all-collections.mjs
  build-mobile-folder.mjs
  README.md
  archive/                                    ← source snapshots (do not import)
    Help-PR-Orders-Module.postman_collection.json
    Help-PR-Order-Charges-Payments.postman_collection.json
    …
```

When adding a new module, edit or add a file under `archive/`, extend `merge-all-collections.mjs` if needed (e.g. built-in requests like Partner payout), then re-run the merge script.

# Postman — single collection

Use **one** collection for all APIs:

| File | Purpose |
|------|---------|
| **`Help-PR-All-APIs.postman_collection.json`** | **Import this only** — all modules, deduplicated |

Legacy per-module collections live in **`archive/`** (not for import).

## Setup

1. Postman → **Import** → `Help-PR-All-APIs.postman_collection.json`
2. Collection variables → set **`baseUrl`** (e.g. `http://localhost:5001`)
3. Run **`00 — Auth` → `Login`** — saves JWT to **`accessToken`** and **`token`**
4. Open any folder (Order, Partner payout, Expense, …)

**Partner payout UI:** see `docs/PARTNER_PAYOUT_FRONTEND.md` and folder **37 — Partner payout**.

## Regenerate after API changes

```bash
node postman/merge-all-collections.mjs
```

Reads source files from `postman/archive/`, writes `Help-PR-All-APIs.postman_collection.json`.

## Folder layout

```
postman/
  Help-PR-All-APIs.postman_collection.json   ← import this
  merge-all-collections.mjs
  README.md
  archive/                                    ← source snapshots (do not import)
    Help-PR-Orders-Module.postman_collection.json
    Help-PR-Order-Charges-Payments.postman_collection.json
    …
```

When adding a new module, edit or add a file under `archive/`, extend `merge-all-collections.mjs` if needed (e.g. built-in requests like Partner payout), then re-run the merge script.

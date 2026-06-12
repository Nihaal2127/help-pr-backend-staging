# Mobile Refactor Audit

Short reference for the mobile modularization refactor. **Most admin routes unchanged** — Phase 3 only touched admin address delete and order payment CRUD.

## Summary

- **Scope:** `controllers/mobile/**`, `services/mobile/**`, and three new shared utility modules
- **Net change:** ~1,650 lines removed (42 files touched)
- **Goal:** Reduce duplication between mobile user/partner controllers and services; keep API response shapes unchanged

## New shared modules

| File | Purpose |
|------|---------|
| `utils/mobile_service_result.js` | Shared `fail`, `ok`, `parsePositiveInt`, `parseOptionalBoolean`, `mergeMongoFilters` for mobile services |
| `utils/mobile_controller_helpers.js` | Shared HTTP helpers: `wrapMobileHandler`, `getCallerId`, `sendServiceError`, and response formatters for paginated lists, records, spread data, etc. |
| `services/mobile/shared/order_list_helpers.js` | Shared order list filters, aggregation pipeline, and pagination used by user and partner `order_service.js` |

## What changed

### Controllers (21/21)

All mobile controllers now delegate response formatting to `mobile_controller_helpers.js` instead of repeating try/catch and JSON boilerplate.

Special cases intentionally left as-is:

- **Partner register/update** — still use throw-based error handling from `partner_service`
- **Invoice download** — still returns HTML with `Content-Disposition`
- **Complete order work** — still returns `breakdown` on error and `post` / `post_error` on success
- **Subscription change** — still returns `details` on validation errors

### Services (20 migrated)

Mobile services that used local `fail` / `ok` helpers now import from `mobile_service_result.js`.

**Order services** (`user/order_service.js`, `partner/order_service.js`) were slimmed down to use `order_list_helpers.js` for list logic. Partner-only filters (`partner_payment_status`, `partner_work_status`) and `attachPartnerOrderSummary` on order detail remain partner-only.

### Not changed (through Phase 2)

- Most admin `/api/*` controllers and routes (order, quote, address create/update, etc.)
- `user_service.js`, `partner_service.js`, `catalog_service.js` (inline `{ ok }` pattern)
- Post services (already use `partner_post_common_service`)
- Core shared services (`order_detail_service`, `order_creation_service`, etc.) — consumed only, not modified

## API contract

Response JSON fields, HTTP status codes, and headers are preserved. Examples:

- OTP errors: `"Failed to send OTP."` / `"Failed to verify OTP."`
- Save partner/post: `201` when newly created, `200` when already saved
- Location/catalog/my-services: `result.data` fields spread at the top level of the response

## Smoke-test checklist

**User:** OTP, home, partners, addresses, quotes, orders (list + detail + invoice), payments, posts

**Partner:** register/login, orders (list + work status + complete), additional charges, posts, subscription, wallet/financial payments, location dropdowns

**Admin (sanity):** order list, quote list — should behave as before

## Phase 1 — shared access helpers (done)

| File | Exports |
|------|---------|
| `services/mobile/shared/order_access_helpers.js` | `assertValidCallerObjectId`, `loadCustomerOrder`, `loadPartnerOrder` |
| `services/mobile/shared/partner_access_helpers.js` | `assertActivePartner`, `loadPartnerFranchiseId` |

**Consumers updated:** `order_payment_service`, `order_additional_charge_service`, `order_work_service`, `financial_payments_service`, `wallet_service`, `bank_account_service`, `catalog_service`, and `user`/`partner` `order_service` (caller validation moved to `order_access_helpers`).

`catalog_service` also migrated to `mobile_service_result` (`fail` / `ok`). `USER_TYPE_PARTNER = 2` hardcoding removed from wallet, financial payments, and bank account services.

## Phase 2 — service result migration (done)

### `utils/mobile_service_result.js` extensions
- `okWithMessage(status, message, extra)` — top-level message responses (user auth)
- `okWithData(data)` — `{ ok: true, data }` (partner login/update)
- `okPass()` — internal `{ ok: true }` success

### Services migrated
| Service | Changes |
|---------|---------|
| `user/user_service.js` | Uses `fail`, `okWithMessage` |
| `partner/partner_service.js` | Uses `fail`, `okWithData`, `okPass`; `USER_TYPE_PARTNER` from constants |
| `partner/my_services_service.js` | Uses `assertVerifiedPartner` from `partner_access_helpers` |
| `partner/subscription_change_service.js` | `USER_TYPE_PARTNER` from constants |

### `partner_access_helpers.js` extension
- `assertVerifiedPartner(partnerId)` — active partner + `verification_status === 2`

## Phase 3 — shared address & order payment core (done)

Conservative extraction: shared logic only where mobile and admin behavior align. Admin create/update address paths unchanged (different field names and no location validation).

### New shared modules

| File | Exports |
|------|---------|
| `services/address_location_service.js` | `resolveLocationFields` — state/city/area/pincode chain validation |
| `services/address_lifecycle_service.js` | `softDeleteAddressRecord`, `syncUserProfileOnFirstAddress` |
| `services/order_payment_crud_service.js` | `createOrderPaymentRecord`, `applyOrderPaymentFieldUpdates`, `commitOrderPaymentUpdate`, `softDeleteOrderPaymentRecord`, `syncAfterOrderPaymentChange`, response formatters |

### Consumers updated

| Consumer | What changed |
|----------|--------------|
| `services/mobile/user/address_service.js` | Uses shared location + lifecycle helpers (~90 lines removed) |
| `controllers/address_controller.js` | `deleteAddress` uses `softDeleteAddressRecord` (admin create/update untouched) |
| `services/mobile/user/order_payment_service.js` | CRUD uses shared payment service |
| `controllers/order_payment_controller.js` | Create/update/delete use shared CRUD; auth + partner validation stay in controller |

### API contract notes

- Mobile address/payment responses unchanged.
- Admin address delete preserves existing JSON messages (`Addreses is already deleted`).
- Admin order payment create keeps `autoPaidAtOnCompleted: false` and no string trimming (mobile trims and auto-sets `paid_at` on `completed`).
- Admin partner payment validation still runs **before** save on update.

## Follow-up (optional — Phase 4+)

- Slim admin `order_controller.js` / `quote_controller.js` using existing core services
- Optionally unify admin address create with `resolveLocationFields` when `area_id` is sent
- Add integration tests for high-traffic mobile endpoints

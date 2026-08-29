Google and Apple sign-in here are **mobile ID-token logins**, not a web OAuth redirect. The app signs in with Google/Apple, then posts the **identity token** to this API. The server verifies it, finds or creates a user, and returns the same JWT shape as OTP login.

There is no Google/Apple login on the admin web (`/api/auth/login` is email/password only).

---

## Where it lives

| App | Google | Apple |
|-----|--------|-------|
| Customer (`type: 4`) | `POST /api/mobile/user/google-login` | `POST /api/mobile/user/apple-login` |
| Partner (`type: 2`) | `POST /api/mobile/partner/google-login` | `POST /api/mobile/partner/apple-login` |

Verify helpers:

- `helper/google_auth.js` — `google-auth-library` `verifyIdToken`
- `helper/apple_auth.js` — fetch Apple JWKS, verify JWT (`iss`, `aud`, `RS256`)

Business logic:

- Customer: `services/mobile/user/user_service.js`
- Partner: `services/mobile/partner/partner_service.js`

Customer and partner use **separate OAuth client IDs** so each mobile app has its own Google/Apple project.

---

## What the app sends

**Customer**

```text
{ id_token, device_token?, platform?, device_id?, name? }
```

`name` is Apple-only (first Sign in with Apple). Google name comes from the token.

**Partner** (same, plus optional onboarding fields)

```text
{ id_token, device_token?, platform?, device_id?,
  phone_number?, date_of_birth?, name? }
```

Middleware only requires `id_token`. Partner phone must be E.164-ish if present; DOB must pass the 18+ check.

---

## Step 1 — verify the token (server-side)

```text
App Google/Apple SDK
        │
        │  id_token (JWT)
        ▼
POST /google-login or /apple-login
        │
        ▼
verifyGoogleIdToken()  or  verifyAppleIdToken()
        │
        ├── audience must match env client IDs
        └── extract stable provider id
```

**Google** (`verifyGoogleIdToken`)

- Audience = all configured IDs for that app (`GOOGLE_CLIENT_ID`, `_ANDROID`, `_IOS`, `_WEB`, or the `_PARTNER` set).
- Reads `sub` → `google_id`, plus `email`, `name`, `picture`.

**Apple** (`verifyAppleIdToken`)

- Loads keys from `https://appleid.apple.com/auth/keys` (cached 24h).
- Checks `iss === https://appleid.apple.com`, `aud` in Apple client IDs, algorithm `RS256`.
- Reads `sub` → `apple_id`, plus `email` (often missing after first login; can be a private relay).
- **No name in the token.** Client must send `name` on first authorization.

If env client IDs are empty → `500` “not configured”. Bad/expired token → `401`.

---

## Step 2 — resolve the user (same tree for Google and Apple)

```text
provider id  (google_id or apple_id)
        │
        ├── 1. Find User { google_id/apple_id, deleted_at: null }
        │      yes → must be the right type (customer vs partner)
        │            fill empty name/email/photo
        │            LOGIN
        │
        ├── 2. Soft-deleted account with that provider id?
        │      → 403 contact admin
        │
        ├── 3. Email present → find User by email
        │      yes → same type?  else 409 other account type
        │            already linked to a different Google/Apple? 409
        │            else LINK provider id onto that user  → LOGIN
        │            (registration_type is NOT overwritten)
        │
        └── 4. CREATE new user
               customer: type 4, registration_type 2 (Google) or 3 (Apple)
               partner:  type 2, same registration_type, verification_status 1
```

`google_id` and `apple_id` are **globally unique**. The same Google account cannot be both a customer and a partner. That is a `409`.

Empty name/email/photo are filled in; existing values are left alone.

---

## Customer vs partner create

| | Customer | Partner |
|--|----------|---------|
| Email required to register | No (can be null) | **Yes** — otherwise `400` |
| Extra fields | — | optional `phone_number`, `date_of_birth` |
| After insert | notification settings row | `assignPartnerOnboarding`: settings + default basic subscription |
| `verification_status` | n/a | `1` Pending |
| Login message | Logged in successfully | existing: Login successfully / new: Partner registered successfully |

Blocked users (`is_blocked`) fail at finalize with `403`.

---

## Step 3 — issue the app session

Both paths end in the same login finalize:

1. `user.generateAuthToken()` — JWT `{ id, email, type }` with `JWT_SECRET`, stored on `user.auth_token`, `last_signin` set. **No expiry** in the sign options.
2. Optional FCM: `device_token` on the user + `user_device_token` row (`platform`, `device_id`).
3. Return profile (password stripped). Customer also populates `city_name`.

After this, the app uses `Authorization: Bearer <jwt>` like OTP login.

---

## `registration_type` (set at create only)

| Value | Meaning |
|-------|---------|
| 1 | Mobile OTP |
| 2 | Google |
| 3 | Apple |
| 4 | Admin created |
| 5 | Email/password |

If an OTP or email/password user later signs in with Google/Apple and emails match, the server **links** `google_id` / `apple_id` and does **not** change `registration_type`.

---

## End-to-end picture

```text
CUSTOMER APP                         THIS API
     │
     │  Google/Apple SDK → id_token
     ▼
POST /api/mobile/user/google-login
  or /apple-login
     │
     ├─ verify token (user client IDs)
     ├─ find by google_id / apple_id
     ├─ else link by email (type 4 only)
     ├─ else create type 4
     └─ JWT + optional FCM token
            │
            ▼
      same session as verify-otp


PARTNER APP is the same tree on
POST /api/mobile/partner/google-login | apple-login
  using PARTNER client IDs
  type must be 2
  new users need email + get pending verification + basic plan
```

---

## Client notes that matter

- Send `id_token` from the **same** Firebase/Google/Apple app whose client ID is in env (customer vs partner are different).
- **Apple `name`:** send it on first Sign in with Apple; later tokens have no name.
- **Apple `email`:** often only on first login. Later logins match `apple_id`. Partner **first** registration still needs email in that token.
- Send `device_token` on every login if you want push.
- Web back-office does not use these endpoints.

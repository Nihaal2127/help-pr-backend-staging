# Partner posts — frontend integration guide

This document describes the **partner portfolio / post** APIs in `help-pr-backend-staging`. Partners publish work samples (1–4 images + short description) linked to a **completed order** or **legacy pre-app work**. Customers browse a franchise feed and partner profile gallery, and can **like**, **share** (deep link), and **report** posts.

Postman: **`postman/Help-PR-Mobile-APIs.postman_collection.json`** — folders **Partner → Posts** and **User → Posts**.

---

## 1. Base URL and authentication

| Item | Detail |
|------|--------|
| **Partner APIs** | `{baseUrl}/api/mobile/partner/posts/...` |
| **Customer APIs** | `{baseUrl}/api/mobile/user/posts/...` |
| **Public share resolver** | `GET /api/mobile/user/posts/share/:shareToken` — **no auth** |
| **Admin moderation** | `{baseUrl}/api/partner-post/...` — back-office JWT |
| **Partner auth** | `Authorization: Bearer <partner_token>` (`type` 2) |
| **Customer auth** | `Authorization: Bearer <customer_token>` (`type` 4) |

Response envelope (mobile):

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "data": { },
  "totalItems": 0,
  "totalPages": 0,
  "currentPage": 1,
  "limit": 10
}
```

List endpoints include pagination fields at the top level.

---

## 2. Post types

| `post_type` | When to use | Required fields |
|-------------|-------------|-----------------|
| `order` | Work from a completed in-app order | `order_id`, `description`, 1–4 `images` |
| `legacy_work` | Work done before joining the app | `legacy_service_name` (min 3 chars), `description`, 1–4 `images` |

Optional on `legacy_work`: `category_id`, `service_id` to tag catalog services.

Posts are **auto-published** on create (`status: published`). Reported posts appear in the admin queue; admins can hide them.

---

## 3. Partner app flow

### 3.1 List linkable orders

```
GET /api/mobile/partner/posts/order-options?page=1&limit=10
```

Returns completed orders for the logged-in partner. Each row includes `already_linked: true` if that order already has a post.

### 3.2 Create post (multipart)

```
POST /api/mobile/partner/posts
Content-Type: multipart/form-data
```

| Field | Type | Notes |
|-------|------|-------|
| `post_type` | string | `order` or `legacy_work` |
| `description` | string | Max 500 chars |
| `order_id` | string | Required when `post_type=order` |
| `legacy_service_name` | string | Required when `post_type=legacy_work` |
| `category_id` | string | Optional (legacy) |
| `service_id` | string | Optional (legacy) |
| `images` | file[] | **1–4** JPEG/PNG images |

**403** if partner is not verified (`verification_status` ≠ 2).

### 3.3 Manage own posts

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/posts` | Paginated list of own posts |
| `GET` | `/posts/:postId` | Single post |
| `PUT` | `/posts/:postId` | Update description and/or images |
| `DELETE` | `/posts/:postId` | Soft delete |

**Update images:** send `keep_existing_images` as JSON array of URLs to retain, plus new `images` files. Final count must stay 1–4.

---

## 4. Customer app flow

### 4.1 Discovery feed (home)

```
GET /api/mobile/user/posts/feed?franchise_id={{franchiseId}}&page=1&limit=10
```

Returns published posts from subscribed, verified partners in the franchise. Each item includes `partner`, `linked`, counts, `is_liked`, and `share_url`.

Run **Home** first to obtain `franchise_id`.

### 4.2 Partner profile gallery

```
GET /api/mobile/user/partners/:partnerId/posts?franchise_id={{franchiseId}}
```

Same post shape as feed (without repeating partner block on every card if you prefer — API omits nested partner on this endpoint).

### 4.3 Post detail

```
GET /api/mobile/user/posts/:postId
```

Optional query: `franchise_id` for franchise scope validation.

### 4.4 Interactions

| Action | Method | Path | Response highlights |
|--------|--------|------|---------------------|
| Like / unlike | `POST` | `/posts/:postId/like` | `{ is_liked, likes_count }` |
| Save | `POST` | `/posts/:postId/save` | `{ is_saved, saved_at }` — idempotent |
| Unsave | `DELETE` | `/posts/:postId/save` | `{ is_saved: false }` |
| Share | `POST` | `/posts/:postId/share` | `{ share_url, share_token, shares_count }` |
| Report | `POST` | `/posts/:postId/report` | Body: `{ reason, details? }` |

**Report reasons:** `spam`, `inappropriate`, `misleading`, `other`. One report per user per post (**409** if duplicate).

Save / unsave mirror saved partners: **no request body** on POST; **201** on first save, **200** if already saved; **404** on DELETE if not saved.

### 4.5 My liked & saved posts

```
GET /api/mobile/user/posts/liked?page=1&limit=10
GET /api/mobile/user/posts/saved?page=1&limit=10
```

- **No `franchise_id`** — returns the customer’s collection across franchises.
- Only **published** posts are included (hidden or deleted posts are omitted).
- Sorted by most recently liked / saved.
- Each record uses the same shape as the feed, plus `liked_at` or `saved_at`, and `is_liked` / `is_saved` set accordingly.

### 4.6 Deep link (cold start)

```
GET /api/mobile/user/posts/share/:shareToken
```

No auth. Returns `{ post, share_url }` for app handoff / link preview. Full like/report still requires customer login.

**Env (server):** `MOBILE_APP_DEEP_LINK_BASE=helppr://post` → share URLs like `helppr://post/{share_token}`.

---

## 5. Post object (customer view)

```json
{
  "_id": "...",
  "partner_id": "...",
  "franchise_id": "...",
  "post_type": "order",
  "description": "Kitchen renovation completed last week.",
  "image_urls": ["partner_post/uuid_file.jpg"],
  "likes_count": 12,
  "shares_count": 3,
  "reports_count": 0,
  "is_liked": true,
  "is_saved": false,
  "share_token": "abc123...",
  "share_url": "helppr://post/abc123...",
  "created_at": "2026-06-02T10:00:00.000Z",
  "partner": {
    "_id": "...",
    "name": "Priya",
    "profile_url": "..."
  },
  "linked": {
    "order_id": "...",
    "service_name": "Plumbing",
    "category_name": "Home Services"
  }
}
```

For `legacy_work`, `linked` includes `legacy_service_name` instead of `order_id`.

Image URLs are CDN-prefixed by the global response middleware in production.

---

## 6. Admin moderation (back-office)

Requires back-office JWT (`type` 1, 3, 5, or 6).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/partner-post/reports` | Pending reports (default) with post + reporter summary |
| `GET` | `/api/partner-post/getAll` | All posts; filter by `status`, `partner_id`, `franchise_id` |
| `PUT` | `/api/partner-post/moderate/:postId` | Body: `{ status: "hidden" \| "published" \| "removed" }` |
| `PUT` | `/api/partner-post/reports/:reportId` | Body: `{ status: "reviewed" \| "dismissed" }` |

---

## 7. Suggested UI screens

| Screen | API |
|--------|-----|
| Home discovery feed | `GET /posts/feed` |
| Partner profile → Work tab | `GET /partners/:id/posts` |
| Post detail | `GET /posts/:id` |
| Like button | `POST /posts/:id/like` |
| Save bookmark | `POST /posts/:id/save` / `DELETE /posts/:id/save` |
| My liked posts | `GET /posts/liked` |
| My saved posts | `GET /posts/saved` |
| Share sheet | `POST /posts/:id/share` → native share with `share_url` |
| Report modal | `POST /posts/:id/report` |
| Partner add work | `POST /partner/posts` multipart |
| Open shared link | `GET /posts/share/:token` |

---

## 8. Error codes (common)

| Status | Meaning |
|--------|---------|
| **400** | Validation (missing fields, wrong image count, order not completed) |
| **403** | Wrong app / partner not verified |
| **404** | Post, partner, or order not found |
| **409** | Order already linked to another post; duplicate report |
| **500** | Server error |

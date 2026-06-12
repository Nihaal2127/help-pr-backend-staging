# Partner post moderation — admin frontend guide

**Date:** June 2026  
**Base path:** `/api/partner-post`  
**Related:** [PARTNER_POST_FRONTEND.md](./PARTNER_POST_FRONTEND.md) (mobile partner/customer post APIs)  
**Postman:** **Partner post management** folder in `postman/Help-PR-All-APIs.postman_collection.json`  
**Backend:** `routes/partner_post_routes.js`, `services/partner_post_service.js`, `controllers/partner_post_controller.js`

---

## 1. Overview

Partner posts are work-sample portfolio items (images + description) created by partners via the mobile app. They are **auto-published** on create — there is no pre-moderation step before a post goes live.

Admins manage posts through five back-office endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/partner-post/getCounts` | Dashboard tab counts (post + report statuses) |
| `GET` | `/api/partner-post/getAll` | Browse all posts; filter by status, partner, franchise |
| `GET` | `/api/partner-post/reports` | Customer-reported posts (moderation queue) |
| `PUT` | `/api/partner-post/moderate/:postId` | Hide, republish, or remove a post |
| `PUT` | `/api/partner-post/reports/:reportId` | Mark a report as reviewed or dismissed |

Dashboard counts are also available via `POST /api/getCount` with `"type": "partner-post-management"` (type **16**) — same buckets as `GET /getCounts`. See [GET_COUNT_API_FRONTEND.txt](./GET_COUNT_API_FRONTEND.txt).

Customers report posts via `POST /api/mobile/user/posts/:id/report` (see mobile doc). Each report lands in the admin queue with `status: pending`.

---

## 2. Authentication and access

**Header:** `Authorization: Bearer <back_office_jwt>`

All `/api/partner-post/*` routes require `authMiddleware` + `requireBackoffice`.

| User type | Code | Access |
|-----------|------|--------|
| Franchise admin | 1 | Allowed |
| Employee | 3 | Allowed |
| Super admin | 5 | Allowed |
| Staff | 6 | Allowed |
| Partner | 2 | **403** |
| Customer | 4 | **403** |

**Response envelope (list endpoints):**

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "totalItems": 42,
  "totalPages": 5,
  "currentPage": 1,
  "limit": 10,
  "records": []
}
```

**Response envelope (single-record updates):**

```json
{
  "success": true,
  "status": 200,
  "message": "...",
  "record": {}
}
```

Image URLs in `image_urls` are CDN-prefixed by the global response middleware in production (same as mobile post APIs).

---

## 3. Status values

### 3.1 Post status (`PartnerPost.status`)

| Status | Meaning | Customer visibility |
|--------|---------|-------------------|
| `published` | Live (default on create) | Visible in feed, profile, detail, share |
| `hidden` | Temporarily hidden by admin | Hidden from customers |
| `removed` | Taken down by admin | Hidden from customers |

Posts also have `deleted_at` for soft-delete. Admin `getAll` and `moderate` only operate on posts where `deleted_at` is `null`.

**Customer-facing APIs** only return posts with `status: published` and `deleted_at: null`. Partners can still see their own `hidden` / `removed` posts in the partner app post list.

### 3.2 Report status (`PartnerPostReport.status`)

Separate from post status — tracks admin handling of a customer report.

| Status | Meaning |
|--------|---------|
| `pending` | New report, awaiting admin review (default) |
| `reviewed` | Admin reviewed and acted on (e.g. moderated the post) |
| `dismissed` | Admin reviewed; no action taken on the post |

### 3.3 Report reasons (customer-submitted)

| `reason` | Label suggestion |
|----------|------------------|
| `spam` | Spam |
| `inappropriate` | Inappropriate content |
| `misleading` | Misleading |
| `other` | Other |

Optional `details` (max 1000 characters) from the reporter.

---

## 4. End-to-end moderation flow

```text
Partner creates post (mobile)
      │
      ▼
status: published  →  visible in customer feed
      │
      ▼
Customer reports post (mobile POST /posts/:id/report)
      │
      ▼
Report created: status pending  ·  post.reports_count incremented
      │
      ▼
Admin: GET /api/partner-post/reports?status=pending
      │
      ├─► Action needed?
      │         │
      │         ├─ Yes → PUT /moderate/:postId  { status: "hidden" | "removed" }
      │         │              then PUT /reports/:reportId  { status: "reviewed" }
      │         │
      │         └─ No  → PUT /reports/:reportId  { status: "dismissed" }
      │
      └─► Optional audit: GET /getAll with status / partner_id / franchise_id filters
```

**Important:** Updating a report (`PUT /reports/:reportId`) does **not** change the post status. Moderating the post and closing the report are **two separate API calls**.

---

## 5. Dashboard counts (getCounts)

Use this for tab badges / summary cards on the post management screen. Counts respect the same **franchise role scope** as orders and quotes (`resolvePartnerPostListScope`).

### 5.1 Standalone endpoint

```
GET /api/partner-post/getCounts
```

**Query parameters:**

| Param | Required | Notes |
|-------|----------|-------|
| `franchise_id` | No | Super admin / staff: optional filter. Franchise admin / employee: must match their franchise or omitted (auto-scoped). |
| `partner_id` | No | Further narrow counts to one partner (same as `getAll`) |

**Example:**

```
GET /api/partner-post/getCounts?franchise_id=665a1b2c3d4e5f6789012346&partner_id=665a1b2c3d4e5f6789012345
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post counts fetched successfully.",
  "record": {
    "published": 120,
    "hidden": 4,
    "removed": 2,
    "pending": 3,
    "reviewed": 15,
    "dismissed": 8
  }
}
```

### 5.2 Count buckets

| Key | Source | Matches list filter |
|-----|--------|---------------------|
| `published` | Posts with `status: published` | `GET /getAll?status=published` |
| `hidden` | Posts with `status: hidden` | `GET /getAll?status=hidden` |
| `removed` | Posts with `status: removed` | `GET /getAll?status=removed` |
| `pending` | Reports with `status: pending` on in-scope posts | `GET /reports?status=pending` |
| `reviewed` | Reports with `status: reviewed` on in-scope posts | `GET /reports?status=reviewed` |
| `dismissed` | Reports with `status: dismissed` on in-scope posts | `GET /reports?status=dismissed` |

Post counts (`published`, `hidden`, `removed`) and report counts (`pending`, `reviewed`, `dismissed`) are **independent dimensions**. A post can be `published` while it has `pending` reports.

Report counts only include reports whose **parent post** matches the scope (`deleted_at: null`, plus `franchise_id` / `partner_id` filters).

### 5.3 POST /api/getCount (type 16)

Same six keys in `record`:

```json
POST /api/getCount
{
  "type": "partner-post-management",
  "franchise_id": "<optional ObjectId>",
  "partner_id": "<optional ObjectId>"
}
```

Aliases: `partner_post_management`, `partner-posts`, `partner_posts`, `"16"`.

---

## 6. API reference

### 6.1 List all posts

```
GET /api/partner-post/getAll
```

Paginated browse of all non-deleted partner posts. Use for audit, search, or filtering — not only reported content.

**Query parameters:**

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `page` | No | `1` | Positive integer |
| `limit` | No | `10` | Max `100` |
| `status` | No | (all) | `published` \| `hidden` \| `removed` |
| `partner_id` | No | — | Partner Mongo `_id` |
| `franchise_id` | No | — | Franchise Mongo `_id` |

**Example:**

```
GET /api/partner-post/getAll?page=1&limit=10&status=&partner_id=665a1b2c3d4e5f6789012345&franchise_id=665a1b2c3d4e5f6789012346
```

**200 `records[]` item shape:**

```json
{
  "_id": "665a1b2c3d4e5f6789012347",
  "partner_id": "665a1b2c3d4e5f6789012345",
  "franchise_id": "665a1b2c3d4e5f6789012346",
  "post_type": "order",
  "description": "Kitchen renovation completed last week.",
  "image_urls": ["https://cdn.example.com/partner_post/uuid_file.jpg"],
  "status": "published",
  "share_token": "abc123...",
  "share_url": "helppr://post/abc123...",
  "likes_count": 12,
  "shares_count": 3,
  "reports_count": 1,
  "created_at": "2026-06-02T10:00:00.000Z",
  "updated_at": "2026-06-02T10:00:00.000Z",
  "linked": {
    "order_id": "665a1b2c3d4e5f6789012348",
    "service_name": "Plumbing",
    "category_name": "Home Services"
  },
  "partner": {
    "_id": "665a1b2c3d4e5f6789012345",
    "name": "Priya",
    "profile_url": "https://cdn.example.com/profile.jpg",
    "average_rating": 4.8,
    "rating_count": 42
  }
}
```

For `post_type: "legacy_work"`, `linked` includes `legacy_service_name` instead of `order_id`.

---

### 6.2 List reports (moderation queue)

```
GET /api/partner-post/reports
```

Customer-reported posts for admin review. Defaults to **pending** reports.

**Query parameters:**

| Param | Required | Default | Notes |
|-------|----------|---------|-------|
| `page` | No | `1` | Positive integer |
| `limit` | No | `10` | Max `100` |
| `status` | No | `pending` | `pending` \| `reviewed` \| `dismissed` |

**Example:**

```
GET /api/partner-post/reports?page=1&limit=10&status=pending
```

**200 `records[]` item shape:**

```json
{
  "_id": "665a1b2c3d4e5f6789012350",
  "reason": "inappropriate",
  "details": "Offensive images in the gallery.",
  "status": "pending",
  "created_at": "2026-06-03T14:30:00.000Z",
  "updated_at": "2026-06-03T14:30:00.000Z",
  "reporter": {
    "_id": "665a1b2c3d4e5f6789012351",
    "name": "Rahul",
    "phone_number": "+919876543210"
  },
  "post": {
    "_id": "665a1b2c3d4e5f6789012347",
    "description": "Kitchen renovation completed last week.",
    "status": "published",
    "image_urls": ["https://cdn.example.com/partner_post/uuid_file.jpg"],
    "partner": {
      "_id": "665a1b2c3d4e5f6789012345",
      "name": "Priya",
      "profile_url": "https://cdn.example.com/profile.jpg"
    }
  }
}
```

`post` may be `null` if the underlying post was hard-deleted (unlikely in normal flow).

---

### 6.3 Moderate a post

```
PUT /api/partner-post/moderate/:postId
Content-Type: application/json
```

Change post visibility. Use after reviewing a report or when proactively moderating from the post list.

**Path:**

| Param | Notes |
|-------|-------|
| `postId` | Partner post Mongo `_id` (from `getAll` or `reports`) |

**Body:**

| Field | Required | Values |
|-------|----------|--------|
| `status` | Yes | `published` \| `hidden` \| `removed` |

**Example — hide post:**

```json
{
  "status": "hidden"
}
```

**Example — republish after review:**

```json
{
  "status": "published"
}
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post moderated successfully.",
  "record": { }
}
```

`record` uses the same shape as a `getAll` row (post + nested `partner`).

---

### 6.4 Update report status

```
PUT /api/partner-post/reports/:reportId
Content-Type: application/json
```

Mark a customer report as handled. Does not modify the post.

**Path:**

| Param | Notes |
|-------|-------|
| `reportId` | Report Mongo `_id` (from `GET /reports`) |

**Body:**

| Field | Required | Values |
|-------|----------|--------|
| `status` | Yes | `reviewed` \| `dismissed` |

`pending` is **not** accepted on update.

**Example — acted on report:**

```json
{
  "status": "reviewed"
}
```

**Example — no violation:**

```json
{
  "status": "dismissed"
}
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Report updated successfully.",
  "record": {
    "_id": "665a1b2c3d4e5f6789012350",
    "post_id": "665a1b2c3d4e5f6789012347",
    "user_id": "665a1b2c3d4e5f6789012351",
    "reason": "inappropriate",
    "details": "Offensive images in the gallery.",
    "status": "reviewed",
    "created_at": "2026-06-03T14:30:00.000Z",
    "updated_at": "2026-06-03T15:00:00.000Z"
  }
}
```

---

## 7. Suggested admin UI screens

| Screen | API | Notes |
|--------|-----|-------|
| Dashboard tab badges | `GET /getCounts` | Post tabs: published / hidden / removed · Report tabs: pending / reviewed / dismissed |
| Moderation queue (default landing) | `GET /reports?status=pending` | Show reason, reporter, post preview, partner |
| Report history | `GET /reports?status=reviewed` or `dismissed` | Audit past decisions |
| All posts browser | `GET /getAll` | Filters: status, partner, franchise |
| Hide / remove post | `PUT /moderate/:postId` | Confirm dialog; `hidden` vs `removed` copy |
| Republish post | `PUT /moderate/:postId` `{ "status": "published" }` | From post detail or queue |
| Close report — action taken | `PUT /reports/:reportId` `{ "status": "reviewed" }` | After moderating |
| Close report — no violation | `PUT /reports/:reportId` `{ "status": "dismissed" }` | Without changing post |

**Recommended queue row actions:**

1. **View post** — open images + description from nested `post`
2. **Hide** → `PUT /moderate/:postId` + `PUT /reports/:reportId` with `reviewed`
3. **Remove** → same with `status: removed`
4. **Dismiss** → `PUT /reports/:reportId` with `dismissed` only

---

## 8. Error responses

| HTTP | When | Example `message` |
|------|------|-------------------|
| **400** | Invalid query/body | `Invalid post status filter.` |
| **400** | Invalid Mongo id in path | `Invalid post id.` |
| **400** | Bad moderate body | `status must be one of: published, hidden, removed.` |
| **400** | Bad report update body | `status must be reviewed or dismissed.` |
| **403** | Partner or customer token | `Access denied.` |
| **404** | Post not found / soft-deleted | `Post not found.` |
| **404** | Report not found | `Report not found.` |
| **500** | Server error | `Internal server error.` |

Error envelope:

```json
{
  "success": false,
  "status": 400,
  "message": "status must be one of: published, hidden, removed."
}
```

---

## 9. Mobile APIs (context only)

These are **not** admin routes but drive data into the moderation queue:

| Action | API |
|--------|-----|
| Partner creates post | `POST /api/mobile/partner/posts` |
| Customer reports post | `POST /api/mobile/user/posts/:id/report` |
| Customer feed (published only) | `GET /api/mobile/user/posts/feed` |

Full mobile integration: [PARTNER_POST_FRONTEND.md](./PARTNER_POST_FRONTEND.md).

---

## 10. Postman collection flow

In `Help-PR-All-APIs.postman_collection.json` → **Partner post management**:

1. **Get counts** — dashboard tab badges (`GET /getCounts`)  
2. **Get all posts** — sets `partnerPostId` from first record  
3. **List reports** — sets `partnerPostReportId` and `partnerPostId`  
4. **Moderate post** — uses `{{partnerPostId}}`  
5. **Update report** — uses `{{partnerPostReportId}}`

Run **00 — Auth → Login** first with a back-office account (type 1, 3, 5, or 6).

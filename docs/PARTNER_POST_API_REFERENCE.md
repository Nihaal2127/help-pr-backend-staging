# Partner post management — API reference

**Date:** August 2026  
**Staging base URL:** `https://dtvx6yflf1.execute-api.ap-south-1.amazonaws.com/staging`

This document lists URLs, request bodies, and expected responses for **admin**, **partner**, and **customer** post APIs.

**Related docs:** [PARTNER_POST_FRONTEND.md](./PARTNER_POST_FRONTEND.md) · [PARTNER_POST_ADMIN_FRONTEND.md](./PARTNER_POST_ADMIN_FRONTEND.md)  
**Postman:** `postman/Help-PR-Mobile-APIs.postman_collection.json` — **Partner → Posts**, **User → Posts**  
**Admin Postman:** `postman/Help-PR-All-APIs.postman_collection.json` — **Partner post management**

---

## Authentication

| Role | Header | User `type` |
|------|--------|-------------|
| Admin (back-office) | `Authorization: Bearer <back_office_jwt>` | `1` Franchise admin, `3` Employee, `5` Super admin, `6` Staff |
| Partner (mobile) | `Authorization: Bearer <partner_jwt>` | `2` |
| Customer (mobile) | `Authorization: Bearer <customer_jwt>` | `4` |

**Error envelope (all APIs):**

```json
{
  "success": false,
  "status": 400,
  "message": "Error description."
}
```

---

## Post status reference

| Status | Meaning | Customer visibility |
|--------|---------|---------------------|
| `pending` | Awaiting admin approval (default on create) | Hidden |
| `published` | Approved / live | Visible |
| `rejected` | Admin rejected (`rejection_reason` set) | Hidden |
| `hidden` | Admin temporarily hidden | Hidden |
| `removed` | Admin taken down | Hidden |

Customer APIs only return **`published`** posts where `deleted_at` is `null`.

---

## 1. Admin APIs

**Base path:** `/api/partner-post`  
**Access:** Back-office JWT only (partner/customer → **403**)

### 1.1 Dashboard counts

```
GET /api/partner-post/getCounts
```

**Query (optional):** `franchise_id`, `partner_id`

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post counts fetched successfully.",
  "record": {
    "total": 134,
    "post_pending": 5,
    "published": 120,
    "rejected": 3,
    "hidden": 4,
    "removed": 2,
    "pending": 3,
    "reviewed": 15,
    "dismissed": 8
  }
}
```

| Key | Meaning |
|-----|---------|
| `total` | All in-scope posts (`post_pending` + `published` + `rejected` + `hidden` + `removed`) |
| `post_pending` / `published` / `rejected` / `hidden` / `removed` | Post status buckets — match `GET /getAll?status=<value>` |
| `pending` / `reviewed` / `dismissed` | Customer **report** queue — match `GET /reports?status=<value>` |

**Note:** `pending` here means **report** status, not post approval. Use `post_pending` for posts awaiting admin approval.

---

### 1.2 List all posts

```
GET /api/partner-post/getAll?page=1&limit=10&status=pending
```

**Query:**

| Param | Default | Values |
|-------|---------|--------|
| `page` | `1` | Positive integer |
| `limit` | `10` | Max `100` |
| `status` | (all) | `pending` \| `published` \| `rejected` \| `hidden` \| `removed` |
| `partner_id` | — | Partner Mongo `_id` |
| `franchise_id` | — | Scoped by role |

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Posts retrieved successfully.",
  "totalItems": 5,
  "totalPages": 1,
  "currentPage": 1,
  "limit": 10,
  "records": [
    {
      "_id": "6a353691b07b3cf5f8e8ad2a",
      "partner_id": "665a1b2c3d4e5f6789012345",
      "franchise_id": "665a1b2c3d4e5f6789012346",
      "post_type": "order",
      "description": "Kitchen renovation completed.",
      "image_urls": ["https://cdn.example.com/partner_post/uuid.jpg"],
      "status": "pending",
      "rejection_reason": "",
      "share_token": "abc123...",
      "share_url": "https://staging-app.helppr.in/post/abc123...",
      "likes_count": 0,
      "shares_count": 0,
      "reports_count": 0,
      "created_at": "2026-08-08T10:00:00.000Z",
      "updated_at": "2026-08-08T10:00:00.000Z",
      "linked": {
        "order_id": "665a1b2c3d4e5f6789012348",
        "service_name": "Plumbing",
        "category_name": "Home Services"
      },
      "partner": {
        "_id": "665a1b2c3d4e5f6789012345",
        "name": "Priya",
        "profile_url": "https://cdn.example.com/profile.jpg"
      }
    }
  ]
}
```

---

### 1.3 Approve / reject / moderate post

```
PUT /api/partner-post/moderate/:postId
Content-Type: application/json
```

**Approve pending post:**

```json
{ "status": "published" }
```

**Reject pending post:**

```json
{
  "status": "rejected",
  "rejection_reason": "Images are unclear. Please re-upload better quality photos."
}
```

`rejection_reason` is required when rejecting (no character limit).

**After published — hide / remove / republish:**

```json
{ "status": "hidden" }
```

```json
{ "status": "removed" }
```

```json
{ "status": "published" }
```

**200 response (approval):**

```json
{
  "success": true,
  "status": 200,
  "message": "Post review updated successfully.",
  "record": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "status": "published",
    "rejection_reason": "",
    "...": "full post object"
  }
}
```

**Status rules:**

| Current status | Allowed `status` values |
|----------------|-------------------------|
| `pending` | `published` or `rejected` (+ `rejection_reason` required) |
| `rejected` | `published` (admin override) |
| `published` / `hidden` / `removed` | `published`, `hidden`, `removed` |

**Push notification:** When a post moves to `published` or `rejected` from the approval flow (`pending` → `published`/`rejected`, or `rejected` → `published`), the partner receives an in-app notification and Firebase push (if enabled in their notification settings). The notification is **awaited** before the API responds so Lambda does not drop the FCM send.

| Event | Title | Recipient |
|-------|-------|-----------|
| `PARTNER_POST_APPROVED` | Post approved | Post owner (partner) |
| `PARTNER_POST_REJECTED` | Post rejected | Post owner (partner) — body includes `rejection_reason` |
| `PARTNER_POST_HIDDEN` | Post hidden after publish | Post owner (partner) |
| `PARTNER_POST_REMOVED` | Post removed after publish | Post owner (partner) |

**Back-office notification (in-app):** When a partner submits a post (`POST /api/mobile/partner/posts`, order completion with `publish_as_post`, or **resubmit** after rejection via `PUT /api/mobile/partner/posts/:postId`), admins receive `PARTNER_POST_PENDING_REVIEW` (super admin, staff, franchise admin, employee for that franchise).

When an admin hides or removes a live post (`published`/`hidden` → `hidden`/`removed`), the partner receives `PARTNER_POST_HIDDEN` or `PARTNER_POST_REMOVED` (in-app + push).

---

### 1.4 List customer reports

```
GET /api/partner-post/reports?page=1&limit=10&status=pending
```

Uses the same franchise role scope as `getAll` and `getCounts` (only reports whose parent post is in scope). Optional query: `franchise_id`, `partner_id`.

**200 `records[]` item:**

```json
{
  "_id": "665a1b2c3d4e5f6789012350",
  "reason": "inappropriate",
  "details": "Offensive images.",
  "status": "pending",
  "reporter": {
    "_id": "665a1b2c3d4e5f6789012351",
    "name": "Rahul",
    "phone_number": "+919876543210"
  },
  "post": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "description": "Kitchen renovation.",
    "status": "published",
    "image_urls": ["..."],
    "partner": { "_id": "...", "name": "Priya", "profile_url": "..." }
  }
}
```

---

### 1.5 Close a customer report

```
PUT /api/partner-post/reports/:reportId
Content-Type: application/json
```

```json
{ "status": "reviewed" }
```

```json
{ "status": "dismissed" }
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Report updated successfully.",
  "record": {
    "_id": "665a1b2c3d4e5f6789012350",
    "post_id": "6a353691b07b3cf5f8e8ad2a",
    "reason": "inappropriate",
    "status": "reviewed",
    "...": "..."
  }
}
```

> Closing a report does **not** change the post. Call `PUT /moderate/:postId` separately if needed.

---

## 2. Partner APIs

**Base path:** `/api/mobile/partner`  
**Access:** Partner JWT (`type` 2), verified partner (`verification_status = 2`)

### 2.1 List linkable orders

```
GET /api/mobile/partner/posts/order-options?page=1&limit=10
```

**Body:** None

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Order options retrieved successfully.",
  "totalItems": 2,
  "totalPages": 1,
  "currentPage": 1,
  "limit": 10,
  "data": {
    "records": [
      {
        "_id": "665a1b2c3d4e5f6789012348",
        "unique_id": "ORD-00123",
        "already_linked": false,
        "category_name": "Home Services",
        "service_name": "Plumbing"
      }
    ]
  }
}
```

---

### 2.1b Create video upload session

```
POST /api/mobile/partner/posts/video-upload-session
```

**Body:** none. Returns a TUS ticket (`signature`, `tus_headers`). The Stream API key is **not** in the response. Ticket TTL is 1 hour. Max duration is 60 seconds (enforced after encoding).

Then `POST /posts` with `bunny_video_id` and no `images`.

---

### 2.2 Create post (submitted for approval)

```
POST /api/mobile/partner/posts
Content-Type: multipart/form-data
```

| Field | Required | Notes |
|-------|----------|-------|
| `post_type` | Yes | `order` or `legacy_work` |
| `description` | Yes | Required; no character limit |
| `order_id` | If `post_type=order` | Completed order ID |
| `legacy_service_name` | If `post_type=legacy_work` | Min 3 chars |
| `category_id` | No | Legacy work only |
| `service_id` | No | Legacy work only |
| `images` | If image post | 1–4 image files (JPEG/PNG) |
| `bunny_video_id` | If video post | From `POST /posts/video-upload-session` after TUS upload. Do not send `images`. |

**201 response:**

```json
{
  "success": true,
  "status": 201,
  "message": "Post submitted for approval.",
  "data": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "status": "pending",
    "rejection_reason": "",
    "description": "Kitchen renovation completed.",
    "media_type": "image",
    "image_urls": ["partner_post/uuid_file.jpg"],
    "...": "full post object"
  }
}
```

---

### 2.3 List own posts

```
GET /api/mobile/partner/posts?page=1&limit=10
```

**Body:** None

Partner sees **all** own posts: `pending`, `published`, `rejected`, `hidden`, `removed`.

**200 response:** Paginated list; each record includes `status` and `rejection_reason`.

---

### 2.4 Get single own post

```
GET /api/mobile/partner/posts/:postId
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post retrieved successfully.",
  "data": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "status": "rejected",
    "rejection_reason": "Images are unclear.",
    "...": "full post object"
  }
}
```

---

### 2.5 Update (edit) post

```
PUT /api/mobile/partner/posts/:postId
Content-Type: multipart/form-data
```

**Path param:** `postId` — Mongo `_id` of the post

**Form fields (all optional — send at least one change):**

| Field | Type | Notes |
|-------|------|-------|
| `description` | string | Cannot be empty if sent; no character limit |
| `keep_existing_images` | string (JSON array) | URLs to keep, e.g. `["partner_post/uuid1.jpg"]` |
| `images` | file[] | New image files. Max 4 new files per request |
| `bunny_video_id` | string | Replace media with a video (from a new upload session). Do not send with `images`. |

**Image rules:**

- Final count must be **1–4** images (kept + newly uploaded).
- New `images` **without** `keep_existing_images` → replaces all old images.
- Description-only update → existing images unchanged.
- `post_type`, `order_id`, `legacy_service_name` **cannot** be changed.

**Behaviour by status:**

| Post status | After edit |
|-------------|------------|
| `rejected` | Resets to `pending`; `rejection_reason` cleared; admins notified (`PARTNER_POST_PENDING_REVIEW`) |
| `published` | Stays `published` (changes go live immediately — no re-approval) |
| `pending` | Stays `pending` |
| `hidden` / `removed` | Status unchanged |

#### Example A — Edit description only (approved post)

**Request:**

```
PUT /api/mobile/partner/posts/6a353691b07b3cf5f8e8ad2a

description: Updated kitchen renovation description.
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post updated successfully.",
  "data": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "status": "published",
    "rejection_reason": "",
    "description": "Updated kitchen renovation description.",
    "image_urls": ["partner_post/uuid1.jpg", "partner_post/uuid2.jpg"],
    "...": "full post object"
  }
}
```

#### Example B — Edit images (keep some + add new)

**Request:**

```
PUT /api/mobile/partner/posts/6a353691b07b3cf5f8e8ad2a

keep_existing_images: ["partner_post/uuid1.jpg"]
images: <new_file.jpg>
description: Fixed images as requested.
```

**200 response:** Same shape; `image_urls` reflects kept + new uploads.

#### Example C — Resubmit rejected post

**Request:**

```
PUT /api/mobile/partner/posts/6a353691b07b3cf5f8e8ad2a

description: Re-uploaded with clearer photos.
keep_existing_images: ["partner_post/uuid1.jpg"]
images: <new_file.jpg>
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post updated successfully.",
  "data": {
    "_id": "6a353691b07b3cf5f8e8ad2a",
    "status": "pending",
    "rejection_reason": "",
    "description": "Re-uploaded with clearer photos.",
    "...": "..."
  }
}
```

**Edit errors:**

| Status | Example `message` |
|--------|-------------------|
| **400** | `description cannot be empty.` |
| **400** | `Post must have between 1 and 4 images.` |
| **403** | Partner not verified / inactive |
| **404** | `Post not found.` |

---

### 2.6 Delete post

```
DELETE /api/mobile/partner/posts/:postId
```

**Body:** None

Works for **all** statuses: `pending`, `published`, `rejected`, `hidden`, `removed`.

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post deleted successfully."
}
```

Soft delete (`deleted_at` set). No `data` field in response.

**Delete errors:**

| Status | Example `message` |
|--------|-------------------|
| **400** | `Invalid post id.` |
| **404** | `Post not found.` |

---

## 3. Customer (User) APIs

**Base path:** `/api/mobile/user`  
Customers only interact with **`published`** posts.

### 3.1 Discovery feed

```
GET /api/mobile/user/posts/feed?franchise_id={{franchiseId}}&page=1&limit=10
```

| Query | Required |
|-------|----------|
| `franchise_id` | **Yes** |

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Posts feed retrieved successfully.",
  "totalItems": 20,
  "totalPages": 2,
  "currentPage": 1,
  "limit": 10,
  "data": {
    "franchise_id": "665a1b2c3d4e5f6789012346",
    "franchise_name": "Mumbai Central",
    "records": [
      {
        "_id": "6a353691b07b3cf5f8e8ad2a",
        "status": "published",
        "is_liked": false,
        "is_saved": false,
        "partner": { "_id": "...", "name": "Priya", "profile_url": "..." },
        "...": "..."
      }
    ]
  }
}
```

---

### 3.2 Partner profile gallery

```
GET /api/mobile/user/partners/:partnerId/posts?franchise_id={{franchiseId}}&page=1&limit=10
```

Published posts only.

---

### 3.3 Post detail

```
GET /api/mobile/user/posts/:postId
```

Optional query: `franchise_id`

**404** if post is not `published` or is deleted.

---

### 3.4 Report a post

```
POST /api/mobile/user/posts/:postId/report
Content-Type: application/json
```

**Body:**

```json
{
  "reason": "inappropriate",
  "details": "Optional extra context, max 1000 chars."
}
```

| `reason` | Meaning |
|----------|---------|
| `spam` | Spam |
| `inappropriate` | Inappropriate content |
| `misleading` | Misleading |
| `other` | Other |

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post reported successfully."
}
```

| Status | When |
|--------|------|
| **404** | Post not found / not published |
| **409** | Customer already reported this post |

---

### 3.5 Other customer post actions (published only)

| Action | Method | URL | Body | 200 `data` |
|--------|--------|-----|------|------------|
| Like / unlike | `POST` | `/api/mobile/user/posts/:postId/like` | None | `{ post_id, is_liked, likes_count }` |
| Save | `POST` | `/api/mobile/user/posts/:postId/save` | None | `{ post_id, is_saved, saved_at }` — **201** on first save |
| Unsave | `DELETE` | `/api/mobile/user/posts/:postId/save` | None | `{ post_id, is_saved: false }` |
| Share | `POST` | `/api/mobile/user/posts/:postId/share` | None | `{ post_id, share_url, share_token, shares_count }` |
| Liked list | `GET` | `/api/mobile/user/posts/liked?page=1&limit=10` | — | Paginated `records[]` |
| Saved list | `GET` | `/api/mobile/user/posts/saved?page=1&limit=10` | — | Paginated `records[]` |

---

### 3.6 Public share link (no auth)

```
GET /api/mobile/user/posts/share/:shareToken
```

**200 response:**

```json
{
  "success": true,
  "status": 200,
  "message": "Post retrieved successfully.",
  "data": {
    "post": { "...": "published post only" },
    "share_url": "https://staging-app.helppr.in/post/abc123..."
  }
}
```

---

## End-to-end flows

### Approval

```text
Partner POST /api/mobile/partner/posts
    → status: pending

Admin GET /api/partner-post/getAll?status=pending
    → PUT /api/partner-post/moderate/:postId
        { "status": "published" }  → live
        { "status": "rejected", "rejection_reason": "..." }

Partner PUT /api/mobile/partner/posts/:postId (edit rejected post)
    → status: pending (resubmitted)
```

### Customer report (after published)

```text
Customer POST /api/mobile/user/posts/:postId/report
    → report status: pending

Admin GET /api/partner-post/reports?status=pending
    → PUT /api/partner-post/moderate/:postId  { "status": "hidden" | "removed" }  (optional)
    → PUT /api/partner-post/reports/:reportId  { "status": "reviewed" | "dismissed" }
```

---

## Partner edit / delete summary

| Action | Approved (`published`) | Rejected (`rejected`) |
|--------|------------------------|------------------------|
| **Edit** `PUT .../posts/:postId` | Allowed; stays `published` | Allowed; becomes `pending` |
| **Delete** `DELETE .../posts/:postId` | Allowed | Allowed |

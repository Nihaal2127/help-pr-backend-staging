# Saved partners — customer mobile API

Customers can save partner profiles and list them with the **same filters** as the franchise partner directory, **without** passing `franchise_id` on the saved list.

Base path: `{baseUrl}/api/mobile/user`  
Auth: `Authorization: Bearer <customer_token>` (`type` 4)

Postman: **User → Partners (saved list)**, **Save partner**, **Unsave partner**

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/partners/:partnerId/save` | Save partner (idempotent) |
| `DELETE` | `/partners/:partnerId/save` | Remove from saved list |
| `GET` | `/partners/saved` | List saved partners + filters |

Existing (unchanged):

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/partners?franchise_id=...` | All partners in one franchise |
| `GET` | `/partners/:partnerId?franchise_id=...` | Profile; includes `is_saved` |

---

## Save / unsave

```
POST /api/mobile/user/partners/:partnerId/save
DELETE /api/mobile/user/partners/:partnerId/save
```

- **No request body** — only the path parameter `partnerId` (and customer Bearer token). The server ignores any JSON body on POST.
- Save uses the partner’s franchise from their account (verified + active subscription required).
- **201** first save; **200** if already saved.
- **404** partner not eligible or not found; **404** on delete if not saved.

```json
{
  "success": true,
  "status": 201,
  "message": "Partner saved successfully.",
  "data": {
    "partner_id": "...",
    "franchise_id": "...",
    "is_saved": true,
    "saved_at": "2026-06-02T10:00:00.000Z"
  }
}
```

---

## List saved (no `franchise_id`)

```
GET /api/mobile/user/partners/saved?page=1&limit=10&search=...&plan_name=...&category_id=...&service_id=...&min_price=...&max_price=...
```

Same query parameters as `GET /partners` **except** `franchise_id` is not used.

| Query | Notes |
|-------|--------|
| `page` | Default 1 |
| `limit` | Default 10, max 50 |
| `search` or `q` | Partner name |
| `plan_name` | `basic` \| `silver` \| `gold` \| `platinum` |
| `category_id` | Filter + scope `price_range` |
| `service_id` | Filter + single `price` |
| `min_price` / `max_price` | Price band |

Response (pagination at root, same as partners list):

```json
{
  "success": true,
  "status": 200,
  "message": "Saved partners fetched successfully.",
  "totalItems": 2,
  "totalPages": 1,
  "currentPage": 1,
  "limit": 10,
  "data": {
    "partners": [
      {
        "_id": "...",
        "name": "Priya",
        "profile_url": "...",
        "subscription_plan_name": "gold",
        "plan_priority": 3,
        "categories": [],
        "price": null,
        "price_range": { "min": 500, "max": 1200 },
        "franchise_id": "...",
        "franchise_name": "Hyderabad Central",
        "saved_at": "2026-06-02T09:00:00.000Z",
        "is_saved": true
      }
    ]
  }
}
```

- Sorted by **most recently saved** first.
- Partners who lose subscription or verification no longer appear until they qualify again (save row remains in DB).

---

## UI flow

1. Partner profile → heart → `POST .../save`
2. Saved tab → `GET .../partners/saved` with search/filters
3. Open profile → use `franchise_id` on the card for `GET /partners/:id?franchise_id=...`
4. Unsave → `DELETE .../save`

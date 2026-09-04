# Partner posts — images + video (mind map)

One post = work sample. Media is either 1–4 images or 1 video (≤ 60s). Never both.

```text
                     PARTNER POSTS
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
  WHAT IT IS            CREATE                AFTER CREATE
     │                     │                     │
portfolio card      image path OR          pending → admin
+ description       video path             approve → published
```

## 1. What a post is

```text
POST (partner_post)
├── Who: verified partner (verification_status = 2)
├── Type
│     ├── order        → completed in-app order (order_id)
│     └── legacy_work  → work before the app (legacy_service_name)
├── Media (one only)
│     ├── image  → image_urls[1..4]
│     └── video  → video { bunny_video_id, hls_url, thumbnail, status }
├── status: pending | published | rejected | hidden | removed
└── share_token + share_url  (HTTPS /post/{postId})
```

## 2. Root: two upload paths

```text
                 CREATE POST
                      │
       ┌──────────────┴──────────────┐
       │                             │
  IMAGE POST                    VIDEO POST
  files on THIS API            file on BUNNY
       │                             │
multipart `images`            TUS to Bunny CDN
1–4 JPEG/PNG                  then only send id
```

Bunny AccessKey never goes to the app.

## 3. Image upload

```text
Partner app
    │
    ▼
POST /api/mobile/partner/posts
  multipart: images[] (1–4) + post_type + description
             + order_id  OR  legacy_service_name
    │
    ├── not verified → 403
    ├── 0 or >4 images → 400
    ├── images AND bunny_video_id → 400
    ▼
This backend uploads files (image_uploader)
    │
    ▼
partner_post
  media_type: "image"
  image_urls: [...]
  status: pending
    │
    ▼
Admin inbox: post submitted for review
```

Images live on this stack (S3/CDN). Video files do not.

## 4. Video upload

```text
Partner app  (trim on device to ≤ 60s)
    │
    ▼
① POST /api/mobile/partner/posts/video-upload-session
   partner JWT, no body
    │
    ├── Bunny not configured → 503
    ▼
   Backend:
     create empty Bunny video
     sign TUS ticket (1 hour)
     save partner_post_video_session
    │
    ▼
   Returns: bunny_video_id, tus_endpoint, tus_headers
            (NO AccessKey)
    │
    ▼
② App uploads FILE → https://video.bunnycdn.com/tusupload
   (headers from step ①)
    │
    ▼
③ POST /api/mobile/partner/posts
   JSON/multipart: bunny_video_id + same post fields
   NO images
    │
    ▼
   consume session (one video → one post)
   partner_post
     media_type: "video"
     image_urls: []
     video.status: processing
     status: pending
```

```text
Bunny encoding
    │
    ├── webhook / poll
    │     finished + length ≤ 60s → status ready, hls_url + thumbnail
    │     > 60s                    → failed, Bunny video deleted
    │     encode fail              → failed
    │
Customer feed shows video ONLY if
  published  AND  video.status === "ready"

Partner own list still shows processing / failed
```

## 5. After create (same for image and video)

```text
status = pending
        │
        ▼
Admin  GET /api/partner-post/...
        approve / reject / hide / remove
        │
        ├── published → customers can see
        │                 (video also needs ready)
        └── rejected / hidden / removed → not in customer feed
```

Update: PUT /posts/:id

- Images: keep_existing_images + new files (final 1–4)
- Video: new bunny_video_id from a new session
- Image ↔ video = full replace

Delete: DELETE /posts/:id → soft delete; if video, Bunny object deleted too.

## 6. Customer side (published + ready)

```text
CUSTOMER
├── GET /posts/feed              franchise feed
├── GET /partners/:id/posts      partner gallery
├── GET /posts/:postId           detail
├── POST .../like
├── POST / DELETE .../save
├── POST .../share  → share_url = https://staging-app.helppr.in/post/{id}
└── POST .../report
```

Save/share/like use post id, not “image vs video”.
Share opens the post link (app / store), not the mp4 file.

Public: GET /post/:postId landing HTML → helppr://post/{id}.

## 7. Where files live

```text
IMAGE                 VIDEO
  │                     │
this API                Bunny Stream
upload + CDN            TUS in, HLS out
image_urls[]            video.hls_url
                        video.thumbnail_url
```

## APIs (short)

| Who | Path | Role |
|---|---|---|
| Partner | POST .../posts/video-upload-session | TUS ticket only |
| Partner | POST .../posts | Create (images or bunny_video_id) |
| Partner | GET/PUT/DELETE .../posts/:id | Own posts |
| Bunny | webhook on this API | Mark video ready/failed |
| Customer | .../user/posts/... | Feed, like, save, share |
| Admin | /api/partner-post/... | Approve / hide / remove |

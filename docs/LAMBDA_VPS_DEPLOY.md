# Deploy Lambda + VPS Chat Service

Use this guide after uploading `help-pr-chat-service` to Lightsail.

**Your VPS (staging)**

| Item | Value |
|------|--------|
| Project path | `/var/www/public_html/help-pr-chat-service` |
| Public IPv4 | `13.201.79.72` |
| Private IPv4 | `172.26.15.179` |
| Lambda function | `help-pr-backend-staging` (region `ap-south-1`) |

---

## Part 1 — Verify Chat Service on VPS

SSH into the Lightsail instance, then:

```bash
cd /var/www/public_html/help-pr-chat-service

# 1. Environment
cp .env.example .env
nano .env
```

Set at minimum:

```env
PORT=5001
MONGO_URI=<same MongoDB URI as Lambda>
JWT_SECRET=<same JWT_SECRET as Lambda>
CHAT_SERVICE_INTERNAL_API_KEY=<generate-long-random-secret>
NODE_ENV=production
```

```bash
# 2. Install and run
npm install --production
npm install -g pm2

pm2 start server.js --name help-pr-chat
pm2 save
pm2 startup   # follow the printed command

# 3. Health check (on the server)
curl -s http://127.0.0.1:5001/health
# Expected: {"status":"OK","service":"help-pr-chat-service"}
```

### Lightsail firewall

In Lightsail console → instance → **Networking** → add:

| Application | Port |
|-------------|------|
| Custom TCP | `5001` (temporary; use Nginx on 80/443 later) |

### Internal API test (on VPS)

```bash
curl -s -X POST http://127.0.0.1:5001/internal/chats/order \
  -H "Content-Type: application/json" \
  -H "X-Internal-Api-Key: YOUR_INTERNAL_KEY" \
  -d '{"orderId":"REPLACE_WITH_REAL_ORDER_ID"}'
```

### Optional: Nginx reverse proxy (recommended)

```nginx
# /etc/nginx/sites-available/help-pr-chat
server {
    listen 80;
    server_name 13.201.79.72;   # or chat.yourdomain.com

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then `CHAT_SERVICE_BASE_URL` can be `http://13.201.79.72` (port 80) instead of `:5001`.

Block public access to internal routes:

```nginx
location /internal/ {
    deny all;
    return 404;
}
```

Allow only Lambda egress IPs if you know them, or use a VPC/private link later.

---

## Part 2 — Configure Lambda environment variables

`buildspec.yml` only updates **code**. Set these in **AWS Lambda console** or CLI.

### Required (new)

| Variable | Example | Notes |
|----------|---------|--------|
| `CHAT_SERVICE_ENABLED` | `true` | Enables HTTP provisioning to VPS |
| `CHAT_SERVICE_BASE_URL` | `http://13.201.79.72:5001` | No trailing slash |
| `CHAT_SERVICE_INTERNAL_API_KEY` | same as VPS `.env` | Must match exactly |
| `CHAT_SERVICE_TIMEOUT_MS` | `15000` | Optional; default 10000 |

### Already required (unchanged)

`MONGO_URI`, `JWT_SECRET`, Razorpay, AWS, Firebase, etc.

### AWS Console

1. [Lambda](https://ap-south-1.console.aws.amazon.com/lambda) → **help-pr-backend-staging**
2. **Configuration** → **Environment variables** → **Edit**
3. Add the three `CHAT_SERVICE_*` variables above
4. **Save**

### AWS CLI

```bash
aws lambda update-function-configuration \
  --function-name help-pr-backend-staging \
  --region ap-south-1 \
  --environment "Variables={CHAT_SERVICE_ENABLED=true,CHAT_SERVICE_BASE_URL=http://13.201.79.72:5001,CHAT_SERVICE_INTERNAL_API_KEY=YOUR_SECRET,MONGO_URI=YOUR_URI,JWT_SECRET=YOUR_JWT,...}"
```

Merge with existing variables — do not drop `MONGO_URI` / `JWT_SECRET`.

---

## Part 3 — Deploy Lambda code

### Option A — CodePipeline / CodeBuild (current repo)

Push to the branch that triggers the pipeline:

```bash
cd help-pr-backend-staging
git add .
git commit -m "Enable remote Chat Service integration for Lambda"
git push origin staging
```

`buildspec.yml` runs `npm ci`, zips, and `aws lambda update-function-code`.

### Option B — Manual zip deploy

```bash
cd help-pr-backend-staging
npm ci
zip -r deploy.zip . -x ".git/*" ".github/*" ".env*" "coverage/*" "uploads/*"

aws lambda update-function-code \
  --function-name help-pr-backend-staging \
  --zip-file fileb://deploy.zip \
  --region ap-south-1
```

---

## Part 4 — What changes after deploy

| Component | Lambda | VPS `13.201.79.72` |
|-----------|--------|---------------------|
| Orders, auth, disputes (records) | Yes | No |
| `POST /internal/chats/*` | Calls VPS | Handles |
| `GET /api/chat`, messages, Socket.IO | **Disabled** when flag on | Yes |
| `POST /api/mobile/user/disputes` | Yes (provisions chat on VPS) | No |
| `POST /api/mobile/user/chats/support` | Still on Lambda today* | Also on VPS |

\*Point mobile **chat UI** (inbox, messages, socket, support) at the VPS base URL. Dispute **raise** stays on Lambda API.

---

## Part 5 — Client / app configuration

| Setting | Value |
|---------|--------|
| Main API (Lambda) | Your existing API Gateway URL |
| Chat API + WebSocket | `http://13.201.79.72:5001` or `http://chat.yourdomain.com` |

Mobile / web must use **two base URLs**:

- Business: Lambda  
- Chat REST: `{{chatBaseUrl}}/api/chat`  
- Socket.IO: same host as `chatBaseUrl`  
- Support chat: `{{chatBaseUrl}}/api/mobile/user/chats/support`

---

## Part 6 — Smoke test after deploy

1. **VPS health:** `curl http://13.201.79.72:5001/health`
2. **Lambda health:** `curl https://YOUR_API_GATEWAY/health`
3. **Create order** (completed flow) → check MongoDB `orders.chat_id` populated
4. **Chat inbox:** `GET http://13.201.79.72:5001/api/chat` with Bearer JWT
5. **Raise dispute** via Lambda mobile API → `disputes.chat_id` set
6. **Socket:** connect to VPS with JWT, `join_chat`, `send_message`

### Lambda → VPS connectivity

If order/dispute chat is missing after create:

- CloudWatch logs: `Chat service post /internal/chats/order: ...`
- Lightsail firewall allows inbound `5001` from internet (Lambda uses public egress)
- `CHAT_SERVICE_BASE_URL` reachable from Lambda (test with timeout errors in logs)

---

## Part 7 — Rollback

1. Lambda: set `CHAT_SERVICE_ENABLED=false` (or remove it)
2. Redeploy previous Lambda code if needed
3. Lambda serves `/api/chat` again (no Socket.IO on Lambda — clients still need VPS for realtime until full cutover)

---

## Checklist

- [ ] VPS: `.env` with `MONGO_URI`, `JWT_SECRET`, `CHAT_SERVICE_INTERNAL_API_KEY`
- [ ] VPS: `pm2` running, `curl /health` OK
- [ ] Lightsail firewall: port `5001` (or Nginx `80`)
- [ ] Lambda env: `CHAT_SERVICE_ENABLED=true`, `BASE_URL`, `INTERNAL_API_KEY`
- [ ] Lambda code deployed (pipeline or manual zip)
- [ ] Mobile/web `chatBaseUrl` → VPS
- [ ] Firebase `adminsdk.json` on VPS `resources/` for push (optional)

See also: [CHAT_SERVICE_ARCHITECTURE.md](./CHAT_SERVICE_ARCHITECTURE.md)

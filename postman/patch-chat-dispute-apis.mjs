/**
 * Add chat / dispute Postman requests to All-APIs and Mobile-APIs collections.
 * Run: node postman/patch-chat-dispute-apis.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const authHeader = {
  key: "Authorization",
  value: "Bearer {{accessToken}}",
  type: "text",
};

const jsonHeader = [
  authHeader,
  { key: "Content-Type", value: "application/json", type: "text" },
  { key: "Accept", value: "application/json", type: "text" },
];

const mobileAuthHeader = [
  { key: "Authorization", value: "Bearer {{token}}", type: "text" },
  { key: "Accept", value: "application/json", type: "text" },
];

const mobileJsonHeader = [
  ...mobileAuthHeader,
  { key: "Content-Type", value: "application/json", type: "text" },
];

const setChatIdFromList = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "try {",
      "  const j = pm.response.json();",
      "  const c0 = j?.records?.[0];",
      "  if (c0?._id) pm.collectionVariables.set('chatId', String(c0._id));",
      "} catch (e) {}",
    ],
  },
};

const setChatIdFromRecord = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "try {",
      "  const j = pm.response.json();",
      "  const id = j?.record?._id;",
      "  if (id) pm.collectionVariables.set('chatId', String(id));",
      "} catch (e) {}",
    ],
  },
};

const setDisputeIdFromRecord = {
  listen: "test",
  script: {
    type: "text/javascript",
    exec: [
      "try {",
      "  const j = pm.response.json();",
      "  const id = j?.record?._id;",
      "  const chatId = j?.record?.chat_id;",
      "  if (id) pm.collectionVariables.set('disputeId', String(id));",
      "  if (chatId) pm.collectionVariables.set('chatId', String(chatId));",
      "} catch (e) {}",
    ],
  },
};

function req(name, method, urlPath, options = {}) {
  const {
    description = "",
    body = null,
    query = [],
    headers = authHeader,
    headerList = null,
    events = [],
    rawUrl = null,
  } = options;

  const pathParts = urlPath.split("/").filter(Boolean);
  const request = {
    method,
    header: headerList || (Array.isArray(headers) ? headers : [headers]),
    url: {
      raw: rawUrl || `{{baseUrl}}/${pathParts.join("/")}`,
      host: ["{{baseUrl}}"],
      path: pathParts,
    },
  };

  if (query.length) {
    request.url.query = query;
  }
  if (body != null) {
    request.body = {
      mode: "raw",
      raw: typeof body === "string" ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }

  return {
    name,
    event: events,
    request,
    description,
    response: [],
  };
}

function mobileReq(name, method, pathSegments, options = {}) {
  const { description = "", body = null, query = [], events = [] } = options;
  const segs = ["api", "mobile", "user", ...pathSegments];
  const request = {
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{token}}", type: "string" }],
    },
    method,
    header: body != null ? mobileJsonHeader : mobileAuthHeader,
    url: {
      raw: `{{baseUrl}}/${segs.join("/")}${query.length ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&") : ""}`,
      host: ["{{baseUrl}}"],
      path: segs,
    },
  };
  if (query.length) request.url.query = query;
  if (body != null) {
    request.body = {
      mode: "raw",
      raw: typeof body === "string" ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return { name, event: events, request, description, response: [] };
}

const newChatRequests = [
  req("Chat — list (with unreadCount)", "GET", "api/chat", {
    description:
      "**GET /api/chat**\n\nInbox for logged-in user. Each chat includes **`unreadCount`**.\n\nSets `{{chatId}}` from first row.",
    events: [setChatIdFromList],
  }),
  req("Chat — get order chat", "GET", "api/chat/by-order/{{orderId}}", {
    description:
      "**GET /api/chat/by-order/:orderId**\n\nOrder group chat (auto-created on order). Requires access to the order chat.\n\nSets `{{chatId}}` from `record._id`.",
    events: [setChatIdFromRecord],
  }),
  req("Chat — start support (back-office)", "POST", "api/chat/support", {
    headerList: jsonHeader,
    description:
      "**POST /api/chat/support**\n\nStart or resume **support** chat (customer ↔ employee).\n\n| Field | Required | Notes |\n|-------|----------|--------|\n| `customer_id` | Yes* | Required when caller is admin/staff/employee starting for a customer |\n| `employee_id` | Yes* | Required when caller is **admin/staff** (not employee) |\n| `franchise_id` | No | Franchise scope hint |\n| `initial_message` | No | First text message |\n\nEmployee caller: omit `employee_id` (uses self). Customer uses mobile route instead.",
    body: {
      customer_id: "{{userId}}",
      employee_id: "{{employee_id}}",
      initial_message: "Hello, how can we help?",
    },
    events: [setChatIdFromRecord],
  }),
  req("Chat — update status", "PATCH", "api/chat/{{chatId}}/status", {
    headerList: jsonHeader,
    description: "**PATCH /api/chat/:id/status**\n\nClose or reopen chat.\n\n`status`: `open` | `closed` | `pending`",
    body: { status: "closed" },
  }),
  req("Chat — transfer (reassign agent)", "POST", "api/chat/{{chatId}}/transfer", {
    headerList: jsonHeader,
    description:
      "**POST /api/chat/:id/transfer**\n\nReassign handler (`assignedTo`).\n\n**Support & dispute (full handoff):** swaps employee participant — customer stays, previous employee removed, new employee added, `dispute.employee_id` updated, system message posted. Message history unchanged.\n\n**Order group chats:** only updates `assignedTo` (participants unchanged).\n\n| Field | Required |\n|-------|----------|\n| `newAssignedTo` | Yes — active employee `_id` in same franchise |\n\n**Socket:** `transfer_chat` → `chat_assigned`, `chat_updated`, `receive_message` (system).",
    body: {
      newAssignedTo: "{{employee_id}}",
    },
  }),
  req("Chat — add members", "POST", "api/chat/{{chatId}}/members", {
    headerList: jsonHeader,
    description:
      "**POST /api/chat/:id/members**\n\nAdd users to a group chat (e.g. order chat).\n\nBody: `{ \"userIds\": [\"...\"] }`",
    body: {
      userIds: ["{{employee_id}}"],
    },
  }),
  req("Chat — create (manual)", "POST", "api/chat", {
    headerList: jsonHeader,
    description:
      "**POST /api/chat** — manual chat create (prefer auto order / support / dispute flows).\n\n`type`: `support` | `order` | `quote` | `dispute`",
    body: {
      type: "support",
      isGroup: false,
      participants: ["{{userId}}", "{{employee_id}}"],
      assignedTo: "{{employee_id}}",
    },
    events: [setChatIdFromRecord],
  }),
  req("Messages — list", "GET", "api/chat/messages", {
    description: "**GET /api/chat/messages?chatId=**\n\nPaginated history. Optional `after` (ISO date), `limit` (1–200).",
    query: [
      { key: "chatId", value: "{{chatId}}" },
      { key: "limit", value: "50" },
    ],
  }),
  req("Messages — send", "POST", "api/chat/messages", {
    headerList: jsonHeader,
    description:
      "**POST /api/chat/messages**\n\nREST fallback when Socket.IO unavailable.\n\n`type`: `text` | `image` | `file`",
    body: {
      chatId: "{{chatId}}",
      type: "text",
      content: "Test message from Postman",
    },
  }),
];

const disputeFolder = {
  name: "45 — Dispute",
  description:
    "**/api/dispute** — Disputes on **completed** orders (employee ↔ customer chat).\n\n**Frontend doc:** `docs/CHAT_MODULE_FRONTEND.md`\n\n**Access:** Franchise admin, employee, super admin, staff — back-office JWT.\n\n**Auth:** `Bearer {{accessToken}}`\n\n**Flow:** Customer raises via **Mobile → User → Disputes → Raise dispute** → staff **Get all** / **Update status**",
  item: [
    req("1. Get all disputes", "GET", "api/dispute/getAll", {
      description: "**GET /api/dispute/getAll**\n\nFranchise-scoped list. Optional `status`, `order_id`, `franchise_id`, `page`, `limit`.",
      query: [
        { key: "page", value: "{{page}}" },
        { key: "limit", value: "{{limit}}" },
        { key: "franchise_id", value: "{{franchiseId}}", disabled: true },
        { key: "status", value: "open", disabled: true },
      ],
      events: [
        {
          listen: "test",
          script: {
            type: "text/javascript",
            exec: [
              "try {",
              "  const j = pm.response.json();",
              "  const d0 = j?.records?.[0];",
              "  if (d0?._id) pm.collectionVariables.set('disputeId', String(d0._id));",
              "  if (d0?.chat_id) pm.collectionVariables.set('chatId', String(d0.chat_id));",
              "} catch (e) {}",
            ],
          },
        },
      ],
    }),
    req("2. Get dispute by id", "GET", "api/dispute/get/{{disputeId}}", {
      description: "**GET /api/dispute/get/:id**\n\nIncludes `chat_id` for opening the dispute thread.",
      events: [setDisputeIdFromRecord],
    }),
    req("3. Update dispute status", "PUT", "api/dispute/update/{{disputeId}}", {
      headerList: jsonHeader,
      description:
        "**PUT /api/dispute/update/:id**\n\n`status`: `open` | `in_review` | `resolved` | `closed`\n\nResolving/closing also closes linked chat.",
      body: { status: "in_review" },
    }),
  ],
};

const mobileChatDisputeFolder = {
  name: "Chat & Disputes",
  description:
    "Customer **support chat** and **order disputes** (completed orders only).\n\n**Doc:** `docs/CHAT_MODULE_FRONTEND.md`\n\n**Flow:** Complete order → **Raise dispute** OR **Start support chat** → use `{{chatId}}` with **39 — Chat → Messages** (admin) or Socket.IO.\n\nOrder group chat: `record.chat_id` on **GET order** or admin **GET /api/chat/by-order/:orderId`.",
  item: [
    mobileReq("Raise dispute", "POST", ["disputes"], {
      description:
        "**POST /api/mobile/user/disputes**\n\n| Field | Required |\n|-------|----------|\n| `order_id` | Yes — completed order owned by customer |\n| `reason` | No |\n| `description` | No |\n\n**409** if open dispute exists or order not completed.\n\nSets `{{disputeId}}` and `{{chatId}}`.",
      body: {
        order_id: "{{orderId}}",
        reason: "Service quality issue",
        description: "Work was not completed as agreed.",
      },
      events: [setDisputeIdFromRecord],
    }),
    mobileReq("List disputes", "GET", ["disputes"], {
      description: "**GET /api/mobile/user/disputes** — paginated list for logged-in customer.",
      query: [
        { key: "page", value: "1" },
        { key: "limit", value: "10" },
      ],
    }),
    mobileReq("Get dispute", "GET", ["disputes", "{{disputeId}}"], {
      description: "**GET /api/mobile/user/disputes/:disputeId**",
    }),
    mobileReq("Start support chat", "POST", ["chats", "support"], {
      description:
        "**POST /api/mobile/user/chats/support**\n\n| Field | Required |\n|-------|----------|\n| `employee_id` | No — auto-picks franchise employee if omitted |\n| `franchise_id` | No |\n| `initial_message` | No |\n\nReturns existing open chat for same customer + employee pair.",
      body: {
        employee_id: "{{employee_id}}",
        initial_message: "I need help with my account",
      },
      events: [setChatIdFromRecord],
    }),
  ],
};

function ensureVariable(collection, key, value = "", description = "") {
  collection.variable = collection.variable || [];
  const existing = collection.variable.find((v) => v.key === key);
  if (existing) {
    if (description && !existing.description) existing.description = description;
    return;
  }
  collection.variable.push({
    key,
    value,
    type: "string",
    enabled: true,
    ...(description ? { description } : {}),
  });
}

function patchAllApis(collection) {
  const chatFolder = collection.item.find((f) => f.name === "39 — Chat");
  if (!chatFolder) throw new Error("39 — Chat folder not found");

  chatFolder.description =
    "**/api/chat** — Messaging (order group, dispute, support).\n\n**Doc:** `docs/CHAT_MODULE_FRONTEND.md`\n\n**Auth:** `Bearer {{accessToken}}`\n\n**Auto:** Order group chat on order create (`chat_id` on order). **Socket.IO** on same host when not on Lambda.\n\n**Variables:** `{{chatId}}` · `{{orderId}}` · `{{employee_id}}` · `{{userId}}` (customer)";

  chatFolder.item = newChatRequests;

  const hasDispute = collection.item.some((f) => f.name === "45 — Dispute");
  if (!hasDispute) {
    const apptIdx = collection.item.findIndex((f) => f.name === "44 — Appointment (calendar)");
    const insertAt = apptIdx >= 0 ? apptIdx + 1 : collection.item.length;
    collection.item.splice(insertAt, 0, disputeFolder);
  }

  const mobileRoot = collection.item.find((f) => f.name === "Mobile");
  const userFolder = mobileRoot?.item?.find((f) => f.name === "User");
  if (userFolder) {
    const exists = userFolder.item?.some((f) => f.name === "Chat & Disputes");
    if (!exists) {
      const ordersIdx = userFolder.item.findIndex((f) => f.name === "Orders");
      const insertAt = ordersIdx >= 0 ? ordersIdx + 1 : userFolder.item.length;
      userFolder.item.splice(insertAt, 0, mobileChatDisputeFolder);
    }
  }

  ensureVariable(collection, "chatId", "", "Chat Mongo _id");
  ensureVariable(collection, "disputeId", "", "Dispute Mongo _id (from raise or list)");

  return collection;
}

function patchMobileApis(collection) {
  const userFolder = collection.item.find((f) => f.name === "User");
  if (!userFolder) throw new Error("User folder not found in Mobile-APIs");

  const exists = userFolder.item?.some((f) => f.name === "Chat & Disputes");
  if (!exists) {
    const ordersIdx = userFolder.item.findIndex((f) => f.name === "Orders");
    const insertAt = ordersIdx >= 0 ? ordersIdx + 1 : userFolder.item.length;
    userFolder.item.splice(insertAt, 0, mobileChatDisputeFolder);
  }

  collection.info.description = `${collection.info.description}\n\n**Chat & disputes:** User → **Chat & Disputes** (support chat, raise/list disputes). See \`docs/CHAT_MODULE_FRONTEND.md\`.`;

  ensureVariable(collection, "chatId", "", "Chat Mongo _id");
  ensureVariable(collection, "disputeId", "", "Dispute Mongo _id");
  ensureVariable(collection, "employee_id", "", "Employee user _id for support chat");

  return collection;
}

const allPath = path.join(__dirname, "Help-PR-All-APIs.postman_collection.json");
const mobilePath = path.join(__dirname, "Help-PR-Mobile-APIs.postman_collection.json");

const all = patchAllApis(JSON.parse(fs.readFileSync(allPath, "utf8")));
fs.writeFileSync(allPath, `${JSON.stringify(all, null, 2)}\n`);
console.log("Updated Help-PR-All-APIs.postman_collection.json");

const mobile = patchMobileApis(JSON.parse(fs.readFileSync(mobilePath, "utf8")));
fs.writeFileSync(mobilePath, `${JSON.stringify(mobile, null, 2)}\n`);
console.log("Updated Help-PR-Mobile-APIs.postman_collection.json");

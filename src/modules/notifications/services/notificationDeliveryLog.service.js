const mongoose = require("mongoose");
const NotificationDeliveryLog = require("../../../../models/notification_delivery_log");
const { buildFieldDateRangeFilter } = require("../../../../utils/schedule_date_filters");

const MAX_PAGE_SIZE = 100;

const isDeliveryLogEnabled = () =>
  String(process.env.NOTIFICATION_DELIVERY_LOG_ENABLED || "true").toLowerCase() !== "false";

const maskDeviceTokenSuffix = (token) => {
  const value = String(token || "").trim();
  if (!value) return "";
  if (value.length <= 8) return value;
  return `…${value.slice(-8)}`;
};

const logNotificationDelivery = (entry) => {
  if (!isDeliveryLogEnabled()) return;

  const payload = {
    event: entry.event || "",
    category: entry.category || "",
    actor_user_id: entry.actorUserId || null,
    recipient_user_id: entry.recipientUserId,
    recipient_role: entry.recipientRole || "",
    notification_id: entry.notificationId || null,
    title: entry.title || "",
    body: entry.body || "",
    entity_type: entry.entityType || "",
    entity_id: entry.entityId || null,
    franchise_id: entry.franchiseId || null,
    dedupe_key: entry.dedupeKey || null,
    in_app_created: Boolean(entry.inAppCreated),
    push_attempted: Boolean(entry.pushAttempted),
    push_sent: Boolean(entry.pushSent),
    push_skip_reason: entry.pushSkipReason || "",
    push_error: entry.pushError || "",
    push_error_code: entry.pushErrorCode || "",
    firebase_target: entry.firebaseTarget || "",
    device_token_suffix: entry.deviceTokenSuffix || "",
    user_type: entry.userType != null ? Number(entry.userType) : null,
    metadata: entry.metadata || {},
    created_at: new Date(),
  };

  const consoleLine = [
    `[notifications:delivery]`,
    `event=${payload.event}`,
    payload.entity_type ? `entity=${payload.entity_type}:${payload.entity_id || ""}` : null,
    `recipient=${payload.recipient_user_id}`,
    payload.recipient_role ? `role=${payload.recipient_role}` : null,
    `in_app=${payload.in_app_created}`,
    `push_sent=${payload.push_sent}`,
    payload.push_skip_reason ? `skip=${payload.push_skip_reason}` : null,
    payload.push_error ? `error=${payload.push_error}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  if (payload.push_sent) {
    console.log(consoleLine);
  } else if (payload.push_skip_reason || payload.push_error) {
    console.warn(consoleLine);
  } else {
    console.log(consoleLine);
  }

  void NotificationDeliveryLog.create(payload).catch((error) => {
    console.error("[notifications:delivery] log write failed:", error.message);
  });
};

const listDeliveryLogs = async (query = {}) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  const filter = {};

  if (query.event) {
    filter.event = String(query.event).trim();
  }

  if (query.recipient_user_id) {
    const recipientId = String(query.recipient_user_id).trim();
    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      return { ok: false, status: 400, message: "Invalid recipient_user_id." };
    }
    filter.recipient_user_id = recipientId;
  }

  if (query.entity_id) {
    const entityId = String(query.entity_id).trim();
    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      return { ok: false, status: 400, message: "Invalid entity_id." };
    }
    filter.entity_id = entityId;
  }

  if (query.entity_type) {
    filter.entity_type = String(query.entity_type).trim();
  }

  if (query.push_sent !== undefined && query.push_sent !== "") {
    filter.push_sent = String(query.push_sent).toLowerCase() === "true";
  }

  if (query.push_skip_reason) {
    filter.push_skip_reason = String(query.push_skip_reason).trim();
  }

  const dateFilter = buildFieldDateRangeFilter(query, "created_at");
  if (!dateFilter.ok) {
    return { ok: false, status: 400, message: dateFilter.message };
  }
  Object.assign(filter, dateFilter.filter);

  const skip = (page - 1) * limit;
  const [totalItems, records] = await Promise.all([
    NotificationDeliveryLog.countDocuments(filter),
    NotificationDeliveryLog.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    ok: true,
    totalItems,
    totalPages: Math.ceil(totalItems / limit) || 0,
    currentPage: page,
    limit,
    records,
  };
};

module.exports = {
  isDeliveryLogEnabled,
  maskDeviceTokenSuffix,
  logNotificationDelivery,
  listDeliveryLogs,
};

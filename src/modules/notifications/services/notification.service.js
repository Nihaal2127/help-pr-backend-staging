const mongoose = require("mongoose");
const Notification = require("../../../../models/notification");
const User = require("../../../../models/user");
const { mapUserTypeToRole } = require("../../../../constants/user_types");
const { NOTIFICATION_EVENTS } = require("../constants/notification_events");
const { sendPushForNotification } = require("./notificationPush.service");
const { logNotificationDelivery } = require("./notificationDeliveryLog.service");
const { buildFieldDateRangeFilter } = require("../../../../utils/schedule_date_filters");

const MAX_PAGE_SIZE = 100;

const NOTIFICATION_CATEGORIES = [
  "order",
  "quote",
  "subscription",
  "wallet",
  "ticket",
  "chat",
  "system",
  "reminder",
  "admin",
];

const formatNotificationForApi = (doc) => ({
  _id: doc._id,
  title: doc.title,
  body: doc.body,
  category: doc.category,
  event: doc.event,
  is_read: doc.is_read,
  read_at: doc.read_at,
  created_at: doc.created_at,
  entity: {
    type: doc.entity_type || "",
    id: doc.entity_id || null,
  },
  metadata: doc.metadata || {},
  franchise_id: doc.franchise_id || null,
});

const parsePagination = (query = {}) => {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
};

const buildNotificationQueryFilter = (userId, query = {}) => {
  const filter = {
    recipient_user_id: userId,
    deleted_at: null,
  };

  if (query.is_read !== undefined && query.is_read !== "") {
    filter.is_read = String(query.is_read).toLowerCase() === "true";
  }

  if (query.category) {
    const category = String(query.category).trim().toLowerCase();
    if (!NOTIFICATION_CATEGORIES.includes(category)) {
      return {
        ok: false,
        status: 400,
        message: `Invalid category. Use one of: ${NOTIFICATION_CATEGORIES.join(", ")}.`,
      };
    }
    filter.category = category;
  }

  if (query.event) {
    const event = String(query.event).trim();
    if (!NOTIFICATION_EVENTS[event]) {
      return {
        ok: false,
        status: 400,
        message: "Invalid event filter.",
      };
    }
    filter.event = event;
  }

  if (query.franchise_id) {
    const franchiseId = String(query.franchise_id).trim();
    if (!mongoose.Types.ObjectId.isValid(franchiseId)) {
      return {
        ok: false,
        status: 400,
        message: "Invalid franchise_id filter.",
      };
    }
    filter.franchise_id = franchiseId;
  }

  const dateFilter = buildFieldDateRangeFilter(query, "created_at");
  if (!dateFilter.ok) {
    return { ok: false, status: 400, message: dateFilter.message };
  }
  Object.assign(filter, dateFilter.filter);

  return { ok: true, filter };
};

const uniqueRecipientIds = (recipientIds = []) => {
  const seen = new Set();
  return recipientIds.filter((id) => {
    const key = String(id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const excludeActor = (recipientIds, actorUserId) => {
  if (!actorUserId) return recipientIds;
  const actor = String(actorUserId);
  return recipientIds.filter((id) => String(id) !== actor);
};

const resolveRecipientRole = async (userId) => {
  try {
    const user = await User.findById(userId).select("type").lean();
    return user ? mapUserTypeToRole(user.type) : "";
  } catch {
    return "";
  }
};

/**
 * Core notify — persists in-app notifications and optionally sends push.
 * Never throws; logs errors internally.
 */
const notify = async ({
  eventKey,
  actorUserId = null,
  recipientUserIds = [],
  context = {},
  entityType = "",
  entityId = null,
  franchiseId = null,
  metadata = {},
  dedupeKeyPrefix = null,
  pushPreference = "update",
  skipPush = false,
}) => {
  const template = NOTIFICATION_EVENTS[eventKey];
  if (!template) {
    console.error(`[notifications] unknown event: ${eventKey}`);
    return;
  }

  const recipients = excludeActor(uniqueRecipientIds(recipientUserIds), actorUserId);
  if (!recipients.length) return;

  const title = template.title(context);
  const body = template.body(context);
  const now = new Date();
  const sentDeviceTokens = new Set();

  console.log(
    `[notifications:delivery] batch event=${eventKey} entity=${entityType || ""}:${entityId || ""} recipients=${recipients.length} skip_push=${skipPush}`
  );

  for (const recipientId of recipients) {
    const deliveryBase = {
      event: eventKey,
      category: template.category,
      actorUserId,
      recipientUserId: recipientId,
      title,
      body,
      entityType,
      entityId,
      franchiseId,
      metadata,
      inAppCreated: false,
      pushAttempted: !skipPush,
      pushSent: false,
      dedupeKey: null,
    };

    try {
      let dedupeKey = null;
      if (dedupeKeyPrefix) {
        dedupeKey = `${dedupeKeyPrefix}:${recipientId}`;
      }
      deliveryBase.dedupeKey = dedupeKey;

      if (dedupeKey) {
        const existing = await Notification.findOne({ dedupe_key: dedupeKey }).lean();
        if (existing) {
          logNotificationDelivery({
            ...deliveryBase,
            recipientRole: existing.recipient_role || "",
            notificationId: existing._id,
            inAppCreated: false,
            pushAttempted: false,
            pushSkipReason: "dedupe_skipped",
          });
          continue;
        }
      }

      const recipientRole = await resolveRecipientRole(recipientId);

      const doc = await Notification.create({
        recipient_user_id: recipientId,
        actor_user_id: actorUserId || null,
        category: template.category,
        event: eventKey,
        title,
        body,
        entity_type: entityType,
        entity_id: entityId,
        franchise_id: franchiseId || null,
        recipient_role: recipientRole,
        metadata,
        dedupe_key: dedupeKey,
        is_read: false,
        created_at: now,
        updated_at: now,
      });

      deliveryBase.inAppCreated = true;
      deliveryBase.recipientRole = recipientRole;
      deliveryBase.notificationId = doc._id;

      let pushResult = {
        pushSent: false,
        skipReason: skipPush ? "push_disabled_for_hook" : null,
      };

      if (!skipPush) {
        pushResult = await sendPushForNotification({
          userId: recipientId,
          title,
          body,
          pushPreference,
          sentDeviceTokens,
          data: {
            type: template.category,
            notification_id: String(doc._id),
            event: eventKey,
            entity_type: entityType || "",
            entity_id: entityId ? String(entityId) : "",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          },
        });
      }

      if (pushResult.pushSent) {
        await Notification.updateOne(
          { _id: doc._id },
          { $set: { push_sent_at: new Date(), updated_at: new Date() } }
        );
      }

      logNotificationDelivery({
        ...deliveryBase,
        pushSent: pushResult.pushSent,
        pushSkipReason: pushResult.skipReason || "",
        pushError: pushResult.pushError || "",
        pushErrorCode: pushResult.pushErrorCode || "",
        firebaseTarget: pushResult.firebaseTarget || "",
        deviceTokenSuffix: pushResult.deviceTokenSuffix || "",
        userType: pushResult.userType,
      });
    } catch (error) {
      if (error?.code === 11000) {
        logNotificationDelivery({
          ...deliveryBase,
          pushAttempted: false,
          pushSkipReason: "dedupe_skipped",
        });
        continue;
      }
      console.error(
        `[notifications] failed for recipient ${recipientId} event ${eventKey}:`,
        error.message
      );
      logNotificationDelivery({
        ...deliveryBase,
        pushSkipReason: "notify_error",
        pushError: error.message || String(error),
      });
    }
  }
};

const listNotifications = async (userId, query = {}) => {
  const { page, limit, skip } = parsePagination(query);
  const filterResult = buildNotificationQueryFilter(userId, query);
  if (!filterResult.ok) {
    return filterResult;
  }
  const filter = filterResult.filter;

  const unreadFilter = {
    recipient_user_id: userId,
    deleted_at: null,
    is_read: false,
  };
  if (filter.category) unreadFilter.category = filter.category;
  if (filter.event) unreadFilter.event = filter.event;
  if (filter.franchise_id) unreadFilter.franchise_id = filter.franchise_id;
  if (filter.created_at) unreadFilter.created_at = filter.created_at;

  const [totalItems, records, unreadCount] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(unreadFilter),
  ]);

  return {
    ok: true,
    totalItems,
    totalPages: Math.ceil(totalItems / limit) || 0,
    currentPage: page,
    limit,
    unreadCount,
    records: records.map(formatNotificationForApi),
  };
};

const getUnreadCount = async (userId, query = {}) => {
  const filterResult = buildNotificationQueryFilter(userId, {
    ...query,
    is_read: "false",
  });
  if (!filterResult.ok) {
    return filterResult;
  }

  const count = await Notification.countDocuments(filterResult.filter);
  return { ok: true, unreadCount: count };
};

const markAsRead = async (userId, notificationId) => {
  if (!mongoose.Types.ObjectId.isValid(String(notificationId))) {
    return { ok: false, status: 400, message: "Invalid notification id." };
  }

  const doc = await Notification.findOne({
    _id: notificationId,
    recipient_user_id: userId,
    deleted_at: null,
  });

  if (!doc) {
    return { ok: false, status: 404, message: "Notification not found." };
  }

  if (!doc.is_read) {
    doc.is_read = true;
    doc.read_at = new Date();
    doc.updated_at = new Date();
    await doc.save();
  }

  return {
    ok: true,
    status: 200,
    record: formatNotificationForApi(doc.toObject()),
  };
};

const markAllAsRead = async (userId, category = null) => {
  const filter = {
    recipient_user_id: userId,
    deleted_at: null,
    is_read: false,
  };
  if (category) {
    filter.category = String(category).trim().toLowerCase();
  }

  const now = new Date();
  const result = await Notification.updateMany(filter, {
    $set: { is_read: true, read_at: now, updated_at: now },
  });

  return {
    ok: true,
    status: 200,
    modifiedCount: result.modifiedCount || 0,
  };
};

module.exports = {
  notify,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  formatNotificationForApi,
  NOTIFICATION_CATEGORIES,
};

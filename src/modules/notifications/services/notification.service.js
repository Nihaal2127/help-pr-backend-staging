const mongoose = require("mongoose");
const Notification = require("../../../../models/notification");
const User = require("../../../../models/user");
const { mapUserTypeToRole } = require("../../../../constants/user_types");
const { NOTIFICATION_EVENTS } = require("../constants/notification_events");
const { sendPushForNotification } = require("./notificationPush.service");

const MAX_PAGE_SIZE = 100;

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
}) => {
  const template = NOTIFICATION_EVENTS[eventKey];
  if (!template) {
    console.error(`[notifications] unknown event: ${eventKey}`);
    return;
  }

  const recipients = excludeActor(recipientUserIds, actorUserId);
  if (!recipients.length) return;

  const title = template.title(context);
  const body = template.body(context);
  const now = new Date();

  for (const recipientId of recipients) {
    try {
      let dedupeKey = null;
      if (dedupeKeyPrefix) {
        dedupeKey = `${dedupeKeyPrefix}:${recipientId}`;
      }

      if (dedupeKey) {
        const existing = await Notification.findOne({ dedupe_key: dedupeKey }).lean();
        if (existing) continue;
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

      const pushSent = await sendPushForNotification({
        userId: recipientId,
        title,
        body,
        data: {
          type: template.category,
          notification_id: String(doc._id),
          event: eventKey,
          entity_type: entityType || "",
          entity_id: entityId ? String(entityId) : "",
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      });

      if (pushSent) {
        await Notification.updateOne(
          { _id: doc._id },
          { $set: { push_sent_at: new Date(), updated_at: new Date() } }
        );
      }
    } catch (error) {
      if (error?.code === 11000) {
        continue;
      }
      console.error(
        `[notifications] failed for recipient ${recipientId} event ${eventKey}:`,
        error.message
      );
    }
  }
};

const listNotifications = async (userId, query = {}) => {
  const { page, limit, skip } = parsePagination(query);
  const filter = {
    recipient_user_id: userId,
    deleted_at: null,
  };

  if (query.is_read !== undefined && query.is_read !== "") {
    filter.is_read = String(query.is_read).toLowerCase() === "true";
  }

  if (query.category) {
    filter.category = String(query.category).trim().toLowerCase();
  }

  const [totalItems, records, unreadCount] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments({
      recipient_user_id: userId,
      deleted_at: null,
      is_read: false,
    }),
  ]);

  return {
    totalItems,
    totalPages: Math.ceil(totalItems / limit) || 0,
    currentPage: page,
    limit,
    unreadCount,
    records: records.map(formatNotificationForApi),
  };
};

const getUnreadCount = async (userId) => {
  const count = await Notification.countDocuments({
    recipient_user_id: userId,
    deleted_at: null,
    is_read: false,
  });
  return count;
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
};

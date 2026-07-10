const { getCallerId } = require("../utils/auth_caller");
const {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} = require("../src/modules/notifications/services/notification.service");
const { listDeliveryLogs } = require("../src/modules/notifications/services/notificationDeliveryLog.service");

const resolveUserId = (req) => getCallerId(req);

const listHandler = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Access denied.",
      });
    }

    const data = await listNotifications(userId, req.query);
    if (!data.ok) {
      return res.status(data.status || 400).json({
        success: false,
        status: data.status || 400,
        message: data.message,
      });
    }
    const { ok: _ok, ...payload } = data;
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Notifications fetched successfully.",
      ...payload,
    });
  } catch (error) {
    console.error("notification list:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const unreadCountHandler = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Access denied.",
      });
    }

    const result = await getUnreadCount(userId, req.query);
    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        status: result.status || 400,
        message: result.message,
      });
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Unread count fetched successfully.",
      unreadCount: result.unreadCount,
    });
  } catch (error) {
    console.error("notification unread count:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const markReadHandler = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Access denied.",
      });
    }

    const result = await markAsRead(userId, req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Notification marked as read.",
      record: result.record,
    });
  } catch (error) {
    console.error("notification mark read:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const markAllReadHandler = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Access denied.",
      });
    }

    const category = req.body?.category || req.query?.category || null;
    const result = await markAllAsRead(userId, category);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Notifications marked as read.",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("notification mark all read:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const deliveryLogsHandler = async (req, res) => {
  try {
    const data = await listDeliveryLogs(req.query);
    if (!data.ok) {
      return res.status(data.status || 400).json({
        success: false,
        status: data.status || 400,
        message: data.message,
      });
    }
    const { ok: _ok, ...payload } = data;
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Notification delivery logs fetched successfully.",
      ...payload,
    });
  } catch (error) {
    console.error("notification delivery logs:", error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  listHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
  deliveryLogsHandler,
};

const { runAllReminders } = require("../src/modules/notifications/services/notificationReminder.service");

const verifyCronSecret = (req) => {
  const secret = process.env.NOTIFICATION_CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      message: "NOTIFICATION_CRON_SECRET is not configured.",
    };
  }

  const provided = req.headers["x-cron-secret"];
  if (!provided || String(provided) !== String(secret)) {
    return { ok: false, status: 401, message: "Unauthorized." };
  }

  return { ok: true };
};

const runRemindersHandler = async (req, res) => {
  const auth = verifyCronSecret(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      success: false,
      status: auth.status,
      message: auth.message,
    });
  }

  try {
    const result = await runAllReminders();
    return res.status(200).json({
      success: true,
      status: 200,
      data: result,
    });
  } catch (error) {
    console.error("[notifications] reminder cron failed:", error.message || error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Reminder job failed.",
    });
  }
};

module.exports = {
  runRemindersHandler,
  verifyCronSecret,
};

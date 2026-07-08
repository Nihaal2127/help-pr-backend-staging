/**
 * Run scheduled notification reminders (RM1–RM3).
 *
 * Requires:
 *   MONGO_URI (or MONGODB_URI / DB_URL)
 *
 * Usage:
 *   node scripts/run-notification-reminders.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { runAllReminders } = require("../src/modules/notifications/services/notificationReminder.service");

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URL;
  if (!uri) {
    console.error("Set MONGO_URI, MONGODB_URI, or DB_URL");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected. Running notification reminders...");

  try {
    const result = await runAllReminders();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("Reminder job failed:", error.message || error);
  process.exit(1);
});

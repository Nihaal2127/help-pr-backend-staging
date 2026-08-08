/**
 * One-time migration: copy legacy user.device_token values into user_device_tokens.
 *
 * Usage: node scripts/migrate-user-device-tokens.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user");
const { registerDeviceToken } = require("../services/device_token_service");

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is required.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const users = await User.find({
    deleted_at: null,
    device_token: { $exists: true, $nin: [null, ""] },
  })
    .select("_id device_token")
    .lean();

  let migrated = 0;
  for (const user of users) {
    const result = await registerDeviceToken({
      userId: user._id,
      deviceToken: user.device_token,
      platform: "unknown",
    });
    if (result.registered) migrated += 1;
  }

  console.log(`Migrated ${migrated} device token(s) from ${users.length} user(s).`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Migration failed:", error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

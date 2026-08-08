/**
 * One-time migration: copy legacy user.device_token values into user_device_tokens.
 *
 * Usage: node scripts/migrate-user-device-tokens.js
 *
 * Standalone script (no User model import) so it runs without loading JWT/bcrypt.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const User = mongoose.model(
  "user",
  new mongoose.Schema(
    {
      device_token: { type: String, default: null },
      deleted_at: { type: Date, default: null },
    },
    { collection: "users", strict: false }
  )
);

const UserDeviceToken = mongoose.model(
  "user_device_token",
  new mongoose.Schema(
    {
      user_id: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "user" },
      device_token: { type: String, required: true, trim: true },
      platform: { type: String, default: "unknown", trim: true },
      device_id: { type: String, default: null, trim: true },
      last_active_at: { type: Date, default: Date.now },
      created_at: { type: Date, default: Date.now },
      updated_at: { type: Date, default: Date.now },
    },
    { collection: "user_device_tokens" }
  )
);

const normalizeDeviceToken = (value) => {
  const token = value != null ? String(value).trim() : "";
  return token || null;
};

const registerDeviceToken = async ({ userId, deviceToken, platform = "unknown" }) => {
  const token = normalizeDeviceToken(deviceToken);
  if (!token || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return { registered: false };
  }

  const now = new Date();

  await UserDeviceToken.deleteMany({
    device_token: token,
    user_id: { $ne: userId },
  });

  await UserDeviceToken.findOneAndUpdate(
    { user_id: userId, device_token: token },
    {
      $set: {
        platform: platform || "unknown",
        last_active_at: now,
        updated_at: now,
      },
      $setOnInsert: {
        user_id: userId,
        device_token: token,
        created_at: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return { registered: true };
};

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

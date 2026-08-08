const mongoose = require("mongoose");
const User = require("../models/user");
const UserDeviceToken = require("../models/user_device_token");

const STALE_FCM_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

const normalizeDeviceToken = (value) => {
  const token = value != null ? String(value).trim() : "";
  return token || null;
};

const normalizePlatform = (value) => {
  const platform = String(value || "").trim().toLowerCase();
  if (platform === "ios" || platform === "android") return platform;
  return "unknown";
};

const normalizeDeviceId = (value) => {
  const deviceId = value != null ? String(value).trim() : "";
  return deviceId || null;
};

const isStaleFcmTokenError = (code) =>
  STALE_FCM_ERROR_CODES.has(String(code || "").trim());

const syncLatestDeviceTokenOnUser = async (userId) => {
  const latest = await UserDeviceToken.findOne({ user_id: userId })
    .sort({ last_active_at: -1 })
    .select("device_token")
    .lean();

  await User.updateOne(
    { _id: userId },
    { $set: { device_token: latest?.device_token || null, updated_at: new Date() } }
  );
};

const registerDeviceToken = async ({
  userId,
  deviceToken,
  platform = null,
  deviceId = null,
}) => {
  const token = normalizeDeviceToken(deviceToken);
  if (!token || !mongoose.Types.ObjectId.isValid(String(userId))) {
    return { ok: false, registered: false };
  }

  const now = new Date();
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedDeviceId = normalizeDeviceId(deviceId);

  await UserDeviceToken.deleteMany({
    device_token: token,
    user_id: { $ne: userId },
  });

  const filter = { user_id: userId, device_token: token };
  const update = {
    $set: {
      platform: normalizedPlatform,
      device_id: normalizedDeviceId,
      last_active_at: now,
      updated_at: now,
    },
    $setOnInsert: {
      user_id: userId,
      device_token: token,
      created_at: now,
    },
  };

  await UserDeviceToken.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  await syncLatestDeviceTokenOnUser(userId);

  return { ok: true, registered: true };
};

const unregisterDeviceToken = async ({ userId, deviceToken = null, deviceId = null }) => {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    return { ok: false, removedCount: 0 };
  }

  const token = normalizeDeviceToken(deviceToken);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const filter = { user_id: userId };

  if (token) {
    filter.device_token = token;
  } else if (normalizedDeviceId) {
    filter.device_id = normalizedDeviceId;
  } else {
    return { ok: false, removedCount: 0 };
  }

  const result = await UserDeviceToken.deleteMany(filter);
  await syncLatestDeviceTokenOnUser(userId);

  return { ok: true, removedCount: result.deletedCount || 0 };
};

const unregisterAllDeviceTokens = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    return { ok: false, removedCount: 0 };
  }

  const result = await UserDeviceToken.deleteMany({ user_id: userId });
  await User.updateOne(
    { _id: userId },
    { $set: { device_token: null, updated_at: new Date() } }
  );

  return { ok: true, removedCount: result.deletedCount || 0 };
};

const removeDeviceTokenByValue = async (deviceToken) => {
  const token = normalizeDeviceToken(deviceToken);
  if (!token) return { ok: false, removedCount: 0 };

  const existing = await UserDeviceToken.findOne({ device_token: token })
    .select("user_id")
    .lean();
  if (!existing) {
    return { ok: true, removedCount: 0 };
  }

  const result = await UserDeviceToken.deleteOne({ device_token: token });
  await syncLatestDeviceTokenOnUser(existing.user_id);

  return { ok: true, removedCount: result.deletedCount || 0 };
};

const getDeviceTokensForUser = async (userId) => {
  if (!mongoose.Types.ObjectId.isValid(String(userId))) {
    return [];
  }

  const records = await UserDeviceToken.find({ user_id: userId })
    .sort({ last_active_at: -1 })
    .select("device_token")
    .lean();

  const tokens = [];
  const seen = new Set();
  for (const record of records) {
    const token = normalizeDeviceToken(record.device_token);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  if (tokens.length) {
    return tokens;
  }

  const user = await User.findById(userId).select("device_token").lean();
  const legacyToken = normalizeDeviceToken(user?.device_token);
  return legacyToken ? [legacyToken] : [];
};

const buildDeviceRegistrationOptions = ({
  device_token,
  platform,
  device_id,
} = {}) => ({
  deviceToken: device_token,
  platform,
  deviceId: device_id,
});

module.exports = {
  normalizeDeviceToken,
  normalizePlatform,
  normalizeDeviceId,
  isStaleFcmTokenError,
  registerDeviceToken,
  unregisterDeviceToken,
  unregisterAllDeviceTokens,
  removeDeviceTokenByValue,
  getDeviceTokensForUser,
  syncLatestDeviceTokenOnUser,
  buildDeviceRegistrationOptions,
};

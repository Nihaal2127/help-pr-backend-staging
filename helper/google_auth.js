const { OAuth2Client } = require('google-auth-library');

const GOOGLE_APP_USER = 'user';
const GOOGLE_APP_PARTNER = 'partner';

const USER_GOOGLE_CLIENT_ID_ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_ID_ANDROID',
  'GOOGLE_CLIENT_ID_IOS',
  'GOOGLE_CLIENT_ID_WEB',
];

const PARTNER_GOOGLE_CLIENT_ID_ENV_KEYS = [
  'GOOGLE_CLIENT_ID_PARTNER',
  'GOOGLE_CLIENT_ID_ANDROID_PARTNER',
  'GOOGLE_CLIENT_ID_IOS_PARTNER',
  'GOOGLE_CLIENT_ID_WEB_PARTNER',
];

const collectClientIdsFromEnv = (envKeys) => {
  const ids = envKeys
    .map((key) => String(process.env[key] || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
};

/**
 * OAuth client IDs allowed for verifying Google ID tokens.
 * @param {'user'|'partner'} app
 */
const getGoogleClientIds = (app = GOOGLE_APP_USER) => {
  const keys =
    app === GOOGLE_APP_PARTNER ? PARTNER_GOOGLE_CLIENT_ID_ENV_KEYS : USER_GOOGLE_CLIENT_ID_ENV_KEYS;
  return collectClientIdsFromEnv(keys);
};

/**
 * Verify a Google Sign-In ID token from a mobile app.
 * @param {string} idToken
 * @param {{ app?: 'user'|'partner' }} [options]
 */
const verifyGoogleIdToken = async (idToken, { app = GOOGLE_APP_USER } = {}) => {
  const clientIds = getGoogleClientIds(app);
  if (clientIds.length === 0) {
    const label = app === GOOGLE_APP_PARTNER ? 'partner' : 'user';
    throw new Error(`Google OAuth client IDs for ${label} app are not configured.`);
  }

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken: String(idToken).trim(),
    audience: clientIds,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub) {
    throw new Error('Invalid Google token payload.');
  }

  return {
    google_id: payload.sub,
    email: payload.email ? String(payload.email).trim().toLowerCase() : null,
    name: payload.name ? String(payload.name).trim() : null,
    picture: payload.picture ? String(payload.picture).trim() : null,
    email_verified: payload.email_verified === true,
  };
};

module.exports = {
  GOOGLE_APP_USER,
  GOOGLE_APP_PARTNER,
  verifyGoogleIdToken,
  getGoogleClientIds,
};

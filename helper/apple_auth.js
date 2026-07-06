const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const APPLE_APP_USER = 'user';
const APPLE_APP_PARTNER = 'partner';
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URI = 'https://appleid.apple.com/auth/keys';
const JWKS_CACHE_MS = 24 * 60 * 60 * 1000;

const USER_APPLE_CLIENT_ID_ENV_KEYS = [
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_ID_IOS',
  'APPLE_CLIENT_ID_WEB',
];

const PARTNER_APPLE_CLIENT_ID_ENV_KEYS = [
  'APPLE_CLIENT_ID_PARTNER',
  'APPLE_CLIENT_ID_IOS_PARTNER',
  'APPLE_CLIENT_ID_WEB_PARTNER',
];

/** @type {{ fetchedAt: number, keys: object[] }} */
let jwksCache = { fetchedAt: 0, keys: [] };

const collectClientIdsFromEnv = (envKeys) => {
  const ids = envKeys
    .map((key) => String(process.env[key] || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
};

/**
 * Apple client IDs (bundle / service IDs) allowed for verifying identity tokens.
 * @param {'user'|'partner'} app
 */
const getAppleClientIds = (app = APPLE_APP_USER) => {
  const keys =
    app === APPLE_APP_PARTNER ? PARTNER_APPLE_CLIENT_ID_ENV_KEYS : USER_APPLE_CLIENT_ID_ENV_KEYS;
  return collectClientIdsFromEnv(keys);
};

const fetchAppleJwks = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys.length > 0 && now - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }

  const { data } = await axios.get(APPLE_JWKS_URI, { timeout: 10000 });
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (keys.length === 0) {
    throw new Error('Apple JWKS response did not include keys.');
  }

  jwksCache = { fetchedAt: now, keys };
  return keys;
};

const findJwkByKid = (keys, kid) => keys.find((key) => key.kid === kid);

const jwkToPublicKey = (jwk) => crypto.createPublicKey({ key: jwk, format: 'jwk' });

const getSigningKey = async (kid) => {
  let keys = await fetchAppleJwks();
  let jwk = findJwkByKid(keys, kid);

  if (!jwk) {
    keys = await fetchAppleJwks(true);
    jwk = findJwkByKid(keys, kid);
  }

  if (!jwk) {
    throw new Error('Unable to find Apple signing key.');
  }

  return jwkToPublicKey(jwk);
};

/**
 * Verify a Sign in with Apple identity token from a mobile app.
 * @param {string} idToken
 * @param {{ app?: 'user'|'partner' }} [options]
 */
const verifyAppleIdToken = async (idToken, { app = APPLE_APP_USER } = {}) => {
  const clientIds = getAppleClientIds(app);
  if (clientIds.length === 0) {
    const label = app === APPLE_APP_PARTNER ? 'partner' : 'user';
    throw new Error(`Apple client IDs for ${label} app are not configured.`);
  }

  const decoded = jwt.decode(String(idToken).trim(), { complete: true });
  if (!decoded?.header?.kid) {
    throw new Error('Invalid Apple token header.');
  }

  const publicKey = await getSigningKey(decoded.header.kid);
  const payload = jwt.verify(String(idToken).trim(), publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: clientIds,
  });

  if (!payload?.sub) {
    throw new Error('Invalid Apple token payload.');
  }

  return {
    apple_id: payload.sub,
    email: payload.email ? String(payload.email).trim().toLowerCase() : null,
    email_verified: payload.email_verified === true || payload.email_verified === 'true',
    is_private_email: payload.is_private_email === true || payload.is_private_email === 'true',
  };
};

module.exports = {
  APPLE_APP_USER,
  APPLE_APP_PARTNER,
  verifyAppleIdToken,
  getAppleClientIds,
};

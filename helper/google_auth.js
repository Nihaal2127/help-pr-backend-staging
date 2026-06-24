const { OAuth2Client } = require('google-auth-library');

const getGoogleClientIds = () => {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID_ANDROID,
    process.env.GOOGLE_CLIENT_ID_IOS,
    process.env.GOOGLE_CLIENT_ID_WEB,
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  return [...new Set(ids)];
};

/**
 * Verify a Google Sign-In ID token from the mobile app.
 * @param {string} idToken
 * @returns {Promise<{ google_id: string, email: string|null, name: string|null, picture: string|null, email_verified: boolean }>}
 */
const verifyGoogleIdToken = async (idToken) => {
  const clientIds = getGoogleClientIds();
  if (clientIds.length === 0) {
    throw new Error('Google OAuth client IDs are not configured.');
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
  verifyGoogleIdToken,
  getGoogleClientIds,
};

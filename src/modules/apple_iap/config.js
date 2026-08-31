const fs = require('fs');
const path = require('path');
const env = require('../../../config/env');
const { APPLE_IAP_BUNDLE_ID } = require('../../../constants/apple_iap');

const CERTS_DIR = path.join(__dirname, '../../../resources/apple-certs');
const KEY_DIR = path.join(__dirname, '../../../resources/apple');

const getBundleId = () => String(env.APPLE_IAP_BUNDLE_ID || APPLE_IAP_BUNDLE_ID).trim();

const getKeyId = () => String(env.APPLE_IAP_KEY_ID || '').trim();

const getIssuerId = () => String(env.APPLE_IAP_ISSUER_ID || '').trim();

const getAppAppleId = () => {
    const raw = env.APPLE_IAP_APP_APPLE_ID;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return undefined;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
};

const loadPrivateKey = () => {
    const fromEnv = env.APPLE_IAP_PRIVATE_KEY;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).replace(/\\n/g, '\n').trim();
    }

    const configuredPath = env.APPLE_IAP_PRIVATE_KEY_PATH
        ? String(env.APPLE_IAP_PRIVATE_KEY_PATH).trim()
        : '';
    const keyId = getKeyId();
    const candidates = [
        configuredPath,
        path.join(KEY_DIR, `AuthKey_${keyId}.p8`),
        path.join(KEY_DIR, `SubscriptionKey_${keyId}.p8`),
        path.join(KEY_DIR, `${keyId}.p8`),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return fs.readFileSync(candidate, 'utf8').trim();
        }
    }

    return null;
};

const loadRootCertificates = () => {
    if (!fs.existsSync(CERTS_DIR)) {
        return [];
    }
    return fs
        .readdirSync(CERTS_DIR)
        .filter((name) => name.toLowerCase().endsWith('.cer') || name.toLowerCase().endsWith('.der'))
        .map((name) => fs.readFileSync(path.join(CERTS_DIR, name)))
        .filter((buf) => buf && buf.length > 0 && buf.length < 20000);
};

const isConfiguredForApi = () => Boolean(loadPrivateKey() && getKeyId() && getIssuerId());

module.exports = {
    getBundleId,
    getKeyId,
    getIssuerId,
    getAppAppleId,
    loadPrivateKey,
    loadRootCertificates,
    isConfiguredForApi,
};

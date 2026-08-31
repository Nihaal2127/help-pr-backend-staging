const {
    SignedDataVerifier,
    Environment,
    AppStoreServerAPIClient,
} = require('@apple/app-store-server-library');
const {
    getBundleId,
    getKeyId,
    getIssuerId,
    getAppAppleId,
    loadPrivateKey,
    loadRootCertificates,
    isConfiguredForApi,
} = require('./config');

const ENVIRONMENTS = [Environment.PRODUCTION, Environment.SANDBOX];

let rootCertificates = null;
const verifierCache = new Map();
const clientCache = new Map();

const decodeJwsPayload = (jws) => {
    const parts = String(jws || '').split('.');
    if (parts.length < 2) {
        return null;
    }
    try {
        const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (_err) {
        return null;
    }
};

const peekEnvironment = (jws) => {
    const payload = decodeJwsPayload(jws);
    const value = payload?.data?.environment || payload?.environment;
    if (value === Environment.SANDBOX || String(value).toLowerCase() === 'sandbox') {
        return Environment.SANDBOX;
    }
    if (value === Environment.PRODUCTION || String(value).toLowerCase() === 'production') {
        return Environment.PRODUCTION;
    }
    return null;
};

const getRootCertificates = () => {
    if (!rootCertificates) {
        rootCertificates = loadRootCertificates();
    }
    return rootCertificates;
};

const getVerifier = (environment) => {
    const envKey = String(environment);
    if (verifierCache.has(envKey)) {
        return verifierCache.get(envKey);
    }
    const certs = getRootCertificates();
    if (!certs.length) {
        throw new Error('Apple root certificates are not installed.');
    }
    const enableOnlineChecks = process.env.APPLE_IAP_ONLINE_CHECKS !== 'false';
    const verifier = new SignedDataVerifier(
        certs,
        enableOnlineChecks,
        environment,
        getBundleId(),
        environment === Environment.PRODUCTION ? getAppAppleId() : undefined
    );
    verifierCache.set(envKey, verifier);
    return verifier;
};

const getApiClient = (environment) => {
    const envKey = String(environment);
    if (clientCache.has(envKey)) {
        return clientCache.get(envKey);
    }
    const signingKey = loadPrivateKey();
    if (!signingKey) {
        throw new Error('Apple IAP private key is not configured.');
    }
    const client = new AppStoreServerAPIClient(
        signingKey,
        getKeyId(),
        getIssuerId(),
        getBundleId(),
        environment
    );
    clientCache.set(envKey, client);
    return client;
};

const environmentsToTry = (jws) => {
    const peeked = peekEnvironment(jws);
    if (peeked) {
        return [peeked, ...ENVIRONMENTS.filter((env) => env !== peeked)];
    }
    const forced = String(process.env.APPLE_IAP_ENVIRONMENT || '').trim().toLowerCase();
    if (forced === 'sandbox') {
        return [Environment.SANDBOX, Environment.PRODUCTION];
    }
    if (forced === 'production') {
        return [Environment.PRODUCTION, Environment.SANDBOX];
    }
    return ENVIRONMENTS;
};

const verifyAndDecodeTransaction = async (signedTransactionInfo) => {
    const jws = String(signedTransactionInfo || '').trim();
    if (!jws) {
        const err = new Error('signed_transaction_info is required.');
        err.status = 400;
        throw err;
    }

    const errors = [];
    for (const environment of environmentsToTry(jws)) {
        try {
            const decoded = await getVerifier(environment).verifyAndDecodeTransaction(jws);
            return { decoded, environment, signedTransactionInfo: jws };
        } catch (err) {
            errors.push(`${environment}: ${err.message || err}`);
        }
    }

    const err = new Error('Apple transaction could not be verified.');
    err.status = 400;
    err.details = { reason: 'apple_jws_invalid', attempts: errors };
    throw err;
};

const verifyAndDecodeRenewalInfo = async (signedRenewalInfo) => {
    const jws = String(signedRenewalInfo || '').trim();
    if (!jws) {
        return null;
    }
    for (const environment of environmentsToTry(jws)) {
        try {
            return await getVerifier(environment).verifyAndDecodeRenewalInfo(jws);
        } catch (_err) {
            // try next environment
        }
    }
    return null;
};

const verifyAndDecodeNotification = async (signedPayload) => {
    const jws = String(signedPayload || '').trim();
    if (!jws) {
        const err = new Error('signedPayload is required.');
        err.status = 400;
        throw err;
    }

    const errors = [];
    for (const environment of environmentsToTry(jws)) {
        try {
            const decoded = await getVerifier(environment).verifyAndDecodeNotification(jws);
            return { decoded, environment };
        } catch (err) {
            errors.push(`${environment}: ${err.message || err}`);
        }
    }

    const err = new Error('Apple notification could not be verified.');
    err.status = 400;
    err.details = { reason: 'apple_notification_invalid', attempts: errors };
    throw err;
};

const fetchTransactionFromApple = async (transactionId) => {
    const id = String(transactionId || '').trim();
    if (!id || !isConfiguredForApi()) {
        return null;
    }
    for (const environment of ENVIRONMENTS) {
        try {
            const response = await getApiClient(environment).getTransactionInfo(id);
            if (response?.signedTransactionInfo) {
                return verifyAndDecodeTransaction(response.signedTransactionInfo);
            }
        } catch (_err) {
            // try next environment
        }
    }
    return null;
};

const parseWebhookRequest = (req) => {
    const event = req.apiGateway?.event;
    let raw = null;
    if (event?.body != null) {
        raw = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('utf8')
            : typeof event.body === 'string'
              ? event.body
              : JSON.stringify(event.body);
    } else if (Buffer.isBuffer(req.body)) {
        raw = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
        raw = req.body;
    } else if (req.body && typeof req.body === 'object') {
        return { body: req.body, signedPayload: req.body.signedPayload };
    }

    const body = raw ? JSON.parse(raw) : {};
    return { body, signedPayload: body.signedPayload };
};

module.exports = {
    Environment,
    decodeJwsPayload,
    verifyAndDecodeTransaction,
    verifyAndDecodeRenewalInfo,
    verifyAndDecodeNotification,
    fetchTransactionFromApple,
    parseWebhookRequest,
    isConfiguredForApi,
    getBundleId,
};

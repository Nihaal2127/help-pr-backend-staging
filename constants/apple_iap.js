const APPLE_IAP_BUNDLE_ID = 'com.partnerapp.helppr';
const APPLE_IAP_SUBSCRIPTION_GROUP_ID = '22339091';
const APPLE_IAP_SUBSCRIPTION_GROUP_NAME = 'Premium Membership';

/** Plan name → App Store product id. Basic is free and has no IAP product. */
const APPLE_PRODUCT_ID_BY_PLAN = {
    silver: 'com.partnerapp.helppr.silver.monthly',
    gold: 'com.partnerapp.helppr.gold.monthly',
    platinum: 'com.partnerapp.helppr.platinum.monthly',
};

const APPLE_PLAN_BY_PRODUCT_ID = Object.freeze(
    Object.fromEntries(
        Object.entries(APPLE_PRODUCT_ID_BY_PLAN).map(([planName, productId]) => [productId, planName])
    )
);

const APPLE_IAP_PRODUCT_IDS = Object.freeze(Object.values(APPLE_PRODUCT_ID_BY_PLAN));

const appleProductIdForPlanName = (planName) => {
    const key = String(planName || '')
        .trim()
        .toLowerCase();
    return APPLE_PRODUCT_ID_BY_PLAN[key] || null;
};

const planNameForAppleProductId = (productId) => {
    const key = String(productId || '').trim();
    return APPLE_PLAN_BY_PRODUCT_ID[key] || null;
};

const BILLING_SOURCE_APPLE_IAP = 'apple_iap';
const BILLING_SOURCE_RAZORPAY = 'razorpay';
const BILLING_SOURCE_ADMIN = 'admin';

const APPLE_PAYMENT_METHOD = 'apple';

const APPLE_NOTIFICATION_GRANT = new Set([
    'SUBSCRIBED',
    'DID_RENEW',
    'OFFER_REDEEMED',
    'RENEWAL_EXTENDED',
    'RENEWAL_EXTENSION',
]);

const APPLE_NOTIFICATION_REVOKE = new Set([
    'EXPIRED',
    'GRACE_PERIOD_EXPIRED',
    'REFUND',
    'REVOKE',
]);

const APPLE_PENDING_EXPIRY_MS = 24 * 60 * 60 * 1000;

module.exports = {
    APPLE_IAP_BUNDLE_ID,
    APPLE_IAP_SUBSCRIPTION_GROUP_ID,
    APPLE_IAP_SUBSCRIPTION_GROUP_NAME,
    APPLE_PRODUCT_ID_BY_PLAN,
    APPLE_PLAN_BY_PRODUCT_ID,
    APPLE_IAP_PRODUCT_IDS,
    appleProductIdForPlanName,
    planNameForAppleProductId,
    BILLING_SOURCE_APPLE_IAP,
    BILLING_SOURCE_RAZORPAY,
    BILLING_SOURCE_ADMIN,
    APPLE_PAYMENT_METHOD,
    APPLE_NOTIFICATION_GRANT,
    APPLE_NOTIFICATION_REVOKE,
    APPLE_PENDING_EXPIRY_MS,
};

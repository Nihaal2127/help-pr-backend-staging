/**
 * Regenerates Help-PR-Area-Franchise-Subscription.postman_collection.json
 * from Area, Franchise, SubscriptionPlan, and PartnerSubscription collections.
 * Run: node postman/build-combined-collection.js
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const area = JSON.parse(fs.readFileSync(path.join(dir, 'Area.postman_collection.json'), 'utf8'));
const franchise = JSON.parse(fs.readFileSync(path.join(dir, 'Franchise.postman_collection.json'), 'utf8'));
const subscription = JSON.parse(fs.readFileSync(path.join(dir, 'SubscriptionPlan.postman_collection.json'), 'utf8'));
const partnerSubscription = JSON.parse(
    fs.readFileSync(path.join(dir, 'PartnerSubscription.postman_collection.json'), 'utf8')
);

const combined = {
    info: {
        _postman_id: 'f7e8d9c0-help-pr-area-franchise-subscription',
        name: 'Help PR — Area, Franchise, Subscription & Partner Subscription',
        description:
            'Merged collection for `/api/area`, `/api/franchise`, `/api/subscription-plan`, and `/api/partner-subscription`. Set `base_url`, `auth_token`, and id variables in the active environment. Partner subscription admin routes need an Admin token; `GET .../me` needs a Partner token.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
        { key: 'base_url', value: 'http://localhost:5001' },
        { key: 'auth_token', value: '' },
        { key: 'area_id', value: '' },
        { key: 'city_id', value: '' },
        { key: 'state_id', value: '' },
        { key: 'franchise_id', value: '' },
        { key: 'admin_id', value: '' },
        { key: 'partner_id', value: '' },
        { key: 'subscription_plan_id', value: '' },
        { key: 'partner_subscription_id', value: '' },
    ],
    auth: area.auth,
    item: [
        { name: 'Area', item: area.item },
        { name: 'Franchise', item: franchise.item },
        { name: 'Subscription plan', item: subscription.item },
        { name: 'Partner subscription', item: partnerSubscription.item },
    ],
};

const out = path.join(dir, 'Help-PR-Area-Franchise-Subscription.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(combined, null, 2) + '\n');
console.log('Wrote', out);

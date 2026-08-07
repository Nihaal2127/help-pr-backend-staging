const User = require('../models/user');
const { assertFranchiseAccess } = require('./franchise_access');
const { PARTNER_SUBSCRIPTION_SCREEN_MARKERS } = require('../constants/partner_subscription');
const {
    USER_TYPE_ADMIN,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_STAFF,
} = require('./franchise_user_scope');

const matchesPartnerSubscriptionScreen = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return false;
    return PARTNER_SUBSCRIPTION_SCREEN_MARKERS.some(
        (marker) => normalized.includes(marker) || normalized === marker
    );
};

const hasPartnerSubscriptionScreenAccess = (accessibleScreens) => {
    if (!Array.isArray(accessibleScreens) || accessibleScreens.length === 0) {
        return false;
    }
    return accessibleScreens.some((entry) => {
        if (typeof entry === 'string') {
            return matchesPartnerSubscriptionScreen(entry);
        }
        if (entry && typeof entry === 'object') {
            return (
                matchesPartnerSubscriptionScreen(entry.page) ||
                matchesPartnerSubscriptionScreen(entry.url)
            );
        }
        return false;
    });
};

const canManagePartnerSubscriptions = (caller) => {
    const type = Number(caller?.type);
    if (type === USER_TYPE_SUPER_ADMIN) {
        return { ok: true };
    }
    if (type === USER_TYPE_ADMIN) {
        return { ok: true };
    }
    if (type === USER_TYPE_STAFF || type === USER_TYPE_EMPLOYEE) {
        if (!hasPartnerSubscriptionScreenAccess(caller.accessible_screens)) {
            return {
                ok: false,
                status: 403,
                message: 'Partner subscription screen access required.',
            };
        }
        if (type === USER_TYPE_EMPLOYEE && !caller.franchise_id) {
            return {
                ok: false,
                status: 403,
                message: 'Your account is not linked to a franchise.',
            };
        }
        return { ok: true };
    }
    return {
        ok: false,
        status: 403,
        message: 'Super admin, staff, franchise admin, or franchise employee access required.',
    };
};

const assertPartnerFranchiseAccess = async (authUser, partnerId) => {
    const partner = await User.findOne({ _id: partnerId, deleted_at: null })
        .select('franchise_id type')
        .lean();
    if (!partner) {
        return { ok: false, status: 404, message: 'Partner not found.' };
    }
    if (!partner.franchise_id) {
        return { ok: false, status: 403, message: 'Partner is not linked to a franchise.' };
    }
    const access = await assertFranchiseAccess(authUser, partner.franchise_id);
    if (!access.ok) {
        return { ok: false, status: access.status, message: access.message };
    }
    return { ok: true, franchiseOid: partner.franchise_id };
};

module.exports = {
    matchesPartnerSubscriptionScreen,
    hasPartnerSubscriptionScreenAccess,
    canManagePartnerSubscriptions,
    assertPartnerFranchiseAccess,
};

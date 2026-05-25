const mongoose = require('mongoose');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const { parseObjectId } = require('./franchise_catalog_lists');

/** JWT may use `id` or `_id` depending on login path. */
const resolveReqUserId = (user) => {
    if (!user) return null;
    const raw = user.id ?? user._id ?? user.user_id;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    const s = String(raw).trim();
    return mongoose.isValidObjectId(s) ? s : null;
};

const USER_TYPE_ADMIN = 1;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const isSuperAdminOrStaffType = (type) => {
    const t = Number(type);
    return t === USER_TYPE_SUPER_ADMIN || t === USER_TYPE_STAFF;
};

const isFranchiseStaffType = (type) => {
    const t = Number(type);
    return t === USER_TYPE_ADMIN || t === USER_TYPE_EMPLOYEE;
};

/**
 * Franchise ObjectId for franchise admin (user.franchise_id or Franchise.admin_id) or employee (franchise_id).
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ type: number, franchise_id?: * } | null} [userLean]
 * @returns {Promise<import('mongoose').Types.ObjectId | null>}
 */
const resolveUserFranchiseOid = async (userId, userLean = null) => {
    let user = userLean;
    if (!user) {
        user = await User.findOne({ _id: userId, deleted_at: null })
            .select('type franchise_id')
            .lean();
    }
    if (!user) {
        return null;
    }

    const t = Number(user.type);
    if (t === USER_TYPE_EMPLOYEE) {
        return user.franchise_id || null;
    }
    if (t === USER_TYPE_ADMIN) {
        if (user.franchise_id) {
            return user.franchise_id;
        }
        const franchise = await Franchise.findOne({ admin_id: userId, deleted_at: null })
            .select('_id')
            .lean();
        return franchise?._id ?? null;
    }
    return null;
};

/**
 * Caller role + resolved franchise for dropdown, getCount, and franchise-category scope.
 * @param {string|import('mongoose').Types.ObjectId} userId
 */
const loadFranchiseCallerScope = async (userId) => {
    const idStr = resolveReqUserId(
        typeof userId === 'object' && userId !== null && !(userId instanceof mongoose.Types.ObjectId)
            ? userId
            : { id: userId }
    );
    if (!idStr) {
        return null;
    }

    const user = await User.findOne({ _id: idStr, deleted_at: null })
        .select('type franchise_id')
        .lean();
    if (!user) {
        return null;
    }

    const type = Number(user.type);
    const isSuper = isSuperAdminOrStaffType(type);
    const isFranchiseStaff = isFranchiseStaffType(type);
    const franchiseOid = isFranchiseStaff ? await resolveUserFranchiseOid(idStr, user) : null;

    return {
        user,
        type,
        isSuper,
        isFranchiseAdmin: type === USER_TYPE_ADMIN,
        isEmployee: type === USER_TYPE_EMPLOYEE,
        isFranchiseStaff: isFranchiseStaff && Boolean(franchiseOid),
        franchiseOid,
    };
};

/**
 * Resolve franchise_id for franchise-category / franchise-service getAll (flat catalog list).
 * Franchise staff: always their franchise. Super/staff: franchise_id query required.
 */
const resolveFranchiseCatalogListScope = async (query, userId) => {
    if (userId) {
        const scope = await loadFranchiseCallerScope(userId);
        if (!scope) {
            return { ok: false, status: 403, message: 'Access denied.' };
        }
        if (scope.isFranchiseAdmin || scope.isEmployee) {
            if (!scope.franchiseOid) {
                return { ok: false, status: 403, message: 'Access denied.' };
            }
            if (query.franchise_id) {
                const parsed = parseObjectId(query.franchise_id, 'franchise_id');
                if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
                if (String(parsed.oid) !== String(scope.franchiseOid)) {
                    return { ok: false, status: 403, message: 'Access denied.' };
                }
            }
            return { ok: true, franchiseOid: scope.franchiseOid };
        }
        if (scope.isSuper) {
            if (!query.franchise_id) {
                return { ok: false, status: 400, message: 'Franchise is required.' };
            }
            const parsed = parseObjectId(query.franchise_id, 'franchise_id');
            if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
            return { ok: true, franchiseOid: parsed.oid };
        }
        return { ok: false, status: 403, message: 'Access denied.' };
    }
    if (!query.franchise_id) {
        return { ok: false, status: 400, message: 'Franchise is required.' };
    }
    const parsed = parseObjectId(query.franchise_id, 'franchise_id');
    if (!parsed.ok) return { ok: false, status: 400, message: parsed.message };
    return { ok: true, franchiseOid: parsed.oid };
};

module.exports = {
    resolveReqUserId,
    USER_TYPE_ADMIN,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_STAFF,
    isSuperAdminOrStaffType,
    isFranchiseStaffType,
    resolveUserFranchiseOid,
    loadFranchiseCallerScope,
    resolveFranchiseCatalogListScope,
};

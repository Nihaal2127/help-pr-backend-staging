const User = require('../models/user');
const Franchise = require('../models/franchise');

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
    const user = await User.findOne({ _id: userId, deleted_at: null })
        .select('type franchise_id')
        .lean();
    if (!user) {
        return null;
    }

    const type = Number(user.type);
    const isSuper = isSuperAdminOrStaffType(type);
    const isFranchiseStaff = isFranchiseStaffType(type);
    const franchiseOid = isFranchiseStaff ? await resolveUserFranchiseOid(userId, user) : null;

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

module.exports = {
    USER_TYPE_ADMIN,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_STAFF,
    isSuperAdminOrStaffType,
    isFranchiseStaffType,
    resolveUserFranchiseOid,
    loadFranchiseCallerScope,
};

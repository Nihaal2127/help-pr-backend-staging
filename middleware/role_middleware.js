const User = require('../models/user');

const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const isSuperAdminOrStaff = (type) => {
    const normalizedType = Number(type);
    return normalizedType === USER_TYPE_SUPER_ADMIN || normalizedType === USER_TYPE_STAFF;
};

const isFranchiseAdminOrEmployee = (user) =>
    (user.type === USER_TYPE_ADMIN && user.franchise_id) ||
    (user.type === USER_TYPE_EMPLOYEE && user.franchise_id);

/**
 * Create on franchise category/service linkage: Super Admin or Staff only. After authMiddleware.
 */
const requireSuperAdminOrStaff = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        if (!user || !isSuperAdminOrStaff(user.type)) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Super admin or staff access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requireSuperAdminOrStaff', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * Get / update franchise category or franchise service records:
 * Super Admin, Staff, Franchise Admin (admin with franchise_id), Franchise Employee (employee with franchise_id).
 */
const requireSuperAdminStaffFranchiseAdminEmployee = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select(
            'type franchise_id'
        );
        if (!user) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Access denied.',
            });
        }
        const allowed =
            isSuperAdminOrStaff(user.type) || isFranchiseAdminOrEmployee(user);
        if (!allowed) {
            return res.status(403).json({
                success: false,
                status: 403,
                message:
                    'Super admin, staff, franchise admin, or franchise employee access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requireSuperAdminStaffFranchiseAdminEmployee', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * GET franchise related-catalog: Super Admin, Staff (any franchise), or Admin/Employee whose
 * franchise_id matches :franchise_id. Use after authMiddleware.
 */
const requireFranchiseRelatedCatalogAccess = async (req, res, next) => {
    try {
        const franchiseIdParam =
            req.params.franchise_id !== undefined && req.params.franchise_id !== null
                ? String(req.params.franchise_id).trim()
                : '';
        if (!franchiseIdParam || !/^[a-fA-F0-9]{24}$/.test(franchiseIdParam)) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'franchise_id must be a valid MongoDB ObjectId.',
            });
        }

        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select(
            'type franchise_id'
        );
        if (!user) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Access denied.',
            });
        }

        const t = Number(user.type);
        if (isSuperAdminOrStaff(t)) {
            return next();
        }

        const linked =
            (t === USER_TYPE_ADMIN || t === USER_TYPE_EMPLOYEE) &&
            user.franchise_id &&
            String(user.franchise_id) === franchiseIdParam;

        if (linked) {
            return next();
        }

        return res.status(403).json({
            success: false,
            status: 403,
            message:
                'Super admin, staff, or franchise admin/employee for this franchise only.',
        });
    } catch (err) {
        console.error('requireFranchiseRelatedCatalogAccess', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * Loads caller from DB and requires Admin or Super Admin. Use after authMiddleware.
 */
const requireAdmin = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        if (!user || ![USER_TYPE_ADMIN, USER_TYPE_SUPER_ADMIN].includes(user.type)) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Admin access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requireAdmin', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * Loads caller from DB and requires Super Admin (type === 5). Use after authMiddleware.
 */
const requireSuperAdmin = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        if (!user || user.type !== USER_TYPE_SUPER_ADMIN) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Super admin access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requireSuperAdmin', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * Loads caller from DB and requires Partner (type === 2). Use after authMiddleware.
 */
const requirePartner = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        if (!user || user.type !== USER_TYPE_PARTNER) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Partner access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requirePartner', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

/**
 * Loads caller from DB and requires a back-office role:
 * Super Admin (5), Admin (1), Staff (6), or Employee (3).
 * Explicitly rejects Partner (2) and User (4). Use after authMiddleware.
 */
const BACKOFFICE_TYPES = [
    USER_TYPE_ADMIN,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_STAFF,
];

const requireBackoffice = async (req, res, next) => {
    try {
        const user = await User.findOne({ _id: req.user.id, deleted_at: null }).select('type');
        if (!user || !BACKOFFICE_TYPES.includes(Number(user.type))) {
            return res.status(403).json({
                success: false,
                status: 403,
                message: 'Super admin, admin, staff, or employee access required.',
            });
        }
        next();
    } catch (err) {
        console.error('requireBackoffice', err.message);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error.',
        });
    }
};

module.exports = {
    requireAdmin,
    requireSuperAdmin,
    requirePartner,
    requireSuperAdminOrStaff,
    requireSuperAdminStaffFranchiseAdminEmployee,
    requireFranchiseRelatedCatalogAccess,
    requireBackoffice,
    USER_TYPE_ADMIN,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_PARTNER,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_STAFF,
};

const mongoose = require('mongoose');

/** Matches models/user.js type field */
const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const REQUEST_STATUS = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
};

const ROLE_SNAPSHOT = {
    admin: 'admin',
    employee: 'employee',
    super_admin: 'super_admin',
    staff: 'staff',
};

function requestedRoleFromType(type) {
    if (type === USER_TYPE_ADMIN) return ROLE_SNAPSHOT.admin;
    if (type === USER_TYPE_EMPLOYEE) return ROLE_SNAPSHOT.employee;
    return null;
}

function reviewerRoleFromType(type) {
    if (type === USER_TYPE_SUPER_ADMIN) return ROLE_SNAPSHOT.super_admin;
    if (type === USER_TYPE_STAFF) return ROLE_SNAPSHOT.staff;
    return null;
}

/** Roles allowed to POST /api/service/create */
function canCreateService(type) {
    return (
        type === USER_TYPE_ADMIN ||
        type === USER_TYPE_EMPLOYEE ||
        type === USER_TYPE_SUPER_ADMIN ||
        type === USER_TYPE_STAFF
    );
}

/** Super admin / staff: direct publish without approval workflow */
function isDirectPublishRole(type) {
    return type === USER_TYPE_SUPER_ADMIN || type === USER_TYPE_STAFF;
}

/** Admin / employee: create enters pending request workflow */
function isRequestCreatorRole(type) {
    return type === USER_TYPE_ADMIN || type === USER_TYPE_EMPLOYEE;
}

/** Can approve/reject / edit status fields */
function canManageWorkflow(type) {
    return type === USER_TYPE_SUPER_ADMIN || type === USER_TYPE_STAFF;
}

const WORKFLOW_FIELDS = [
    'request_status',
    'rejection_reason',
    'requested_by_id',
    'requested_by_role',
    'reviewed_by_id',
    'reviewed_by_role',
    'reviewed_at',
    'is_request_mode',
];

function stripWorkflowFields(body) {
    const out = { ...body };
    for (const key of WORKFLOW_FIELDS) delete out[key];
    return out;
}

/** Super admin / staff: client must not overwrite audit / ownership fields; server sets these on status transitions. */
function stripClientSuppliedAuditFields(body) {
    const out = { ...body };
    delete out.requested_by_id;
    delete out.requested_by_role;
    delete out.reviewed_by_id;
    delete out.reviewed_by_role;
    delete out.reviewed_at;
    delete out.is_request_mode;
    return out;
}

/**
 * Extra $match conditions for service list visibility by user type.
 */
function visibilityMatchForList(userType, userId) {
    const oid =
        userId instanceof mongoose.Types.ObjectId
            ? userId
            : new mongoose.Types.ObjectId(String(userId));

    if (userType === USER_TYPE_SUPER_ADMIN || userType === USER_TYPE_STAFF) {
        return {};
    }

    if (userType === USER_TYPE_ADMIN || userType === USER_TYPE_EMPLOYEE) {
        return {
            $or: [
                { is_request_mode: { $ne: true } },
                { is_request_mode: true, request_status: REQUEST_STATUS.ACCEPTED },
                { is_request_mode: true, requested_by_id: oid },
            ],
        };
    }

    return {
        $or: [
            { is_request_mode: { $ne: true } },
            { is_request_mode: true, request_status: REQUEST_STATUS.ACCEPTED },
        ],
    };
}

/** Published-only filter for dropdowns (catalog) */
function publishedCatalogMatch() {
    return {
        $or: [
            { is_request_mode: { $ne: true } },
            {
                is_request_mode: true,
                request_status: REQUEST_STATUS.ACCEPTED,
            },
        ],
    };
}

function canViewServiceDoc(serviceDoc, userType, userId) {
    if (!serviceDoc) return false;
    if (userType === USER_TYPE_SUPER_ADMIN || userType === USER_TYPE_STAFF) return true;

    const oid = String(userId);
    const mode = serviceDoc.is_request_mode === true;
    const status = serviceDoc.request_status || REQUEST_STATUS.ACCEPTED;

    if (userType === USER_TYPE_ADMIN || userType === USER_TYPE_EMPLOYEE) {
        if (!mode) return true;
        if (status === REQUEST_STATUS.ACCEPTED) return true;
        const reqBy = serviceDoc.requested_by_id && serviceDoc.requested_by_id.toString();
        return reqBy === oid;
    }

    if (!mode) return true;
    return status === REQUEST_STATUS.ACCEPTED;
}

function canDeleteService(serviceDoc, userType, userId) {
    if (!serviceDoc) return false;
    if (userType === USER_TYPE_SUPER_ADMIN || userType === USER_TYPE_STAFF) return true;
    if (userType === USER_TYPE_ADMIN || userType === USER_TYPE_EMPLOYEE) {
        const mode = serviceDoc.is_request_mode === true;
        const reqBy = serviceDoc.requested_by_id && serviceDoc.requested_by_id.toString();
        return mode && reqBy === String(userId);
    }
    return false;
}

/** Persisted fields for POST /api/service/create based on creator role */
function workflowFieldsForCreate(userType, userId) {
    const id = new mongoose.Types.ObjectId(userId);
    if (isDirectPublishRole(userType)) {
        return {
            is_request_mode: false,
            request_status: REQUEST_STATUS.ACCEPTED,
            rejection_reason: '',
            requested_by_id: null,
            requested_by_role: null,
            reviewed_by_id: id,
            reviewed_by_role: reviewerRoleFromType(userType),
            reviewed_at: new Date(),
        };
    }
    if (isRequestCreatorRole(userType)) {
        return {
            is_request_mode: true,
            request_status: REQUEST_STATUS.PENDING,
            rejection_reason: '',
            requested_by_id: id,
            requested_by_role: requestedRoleFromType(userType),
            reviewed_by_id: null,
            reviewed_by_role: null,
            reviewed_at: null,
        };
    }
    return null;
}

module.exports = {
    USER_TYPE_ADMIN,
    USER_TYPE_PARTNER,
    USER_TYPE_EMPLOYEE,
    USER_TYPE_CUSTOMER,
    USER_TYPE_SUPER_ADMIN,
    USER_TYPE_STAFF,
    REQUEST_STATUS,
    ROLE_SNAPSHOT,
    requestedRoleFromType,
    reviewerRoleFromType,
    canCreateService,
    isDirectPublishRole,
    isRequestCreatorRole,
    canManageWorkflow,
    WORKFLOW_FIELDS,
    stripWorkflowFields,
    stripClientSuppliedAuditFields,
    visibilityMatchForList,
    publishedCatalogMatch,
    canViewServiceDoc,
    canDeleteService,
    workflowFieldsForCreate,
};

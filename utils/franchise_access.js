const mongoose = require('mongoose');
const { fieldLabel } = require('./field_labels');
const User = require('../models/user');
const Franchise = require('../models/franchise');

const parseFranchiseObjectId = (raw, fieldName = 'franchise_id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/i.test(s)) {
        return {
            ok: false,
            message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId (24 hex characters).`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

/** First non-empty franchise id from query (`franchise_id` or `franchise`) or body. */
const pickFranchiseIdRaw = (query = {}, body = {}) => {
    const candidates = [
        query.franchise_id,
        query.franchise,
        body?.franchise_id,
        body?.franchise,
    ];
    for (const raw of candidates) {
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            return String(raw).trim();
        }
    }
    return null;
};

/** Same sources as GET /api/getCount and user list APIs (query, body, headers). */
const pickFranchiseIdFromReq = (req) => {
    if (!req) return null;
    const candidates = [
        req.query?.franchise_id,
        req.query?.franchise,
        req.body?.franchise_id,
        req.body?.franchise,
        req.headers?.franchise_id,
        req.headers?.franchise,
    ];
    for (const raw of candidates) {
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            return String(raw).trim();
        }
    }
    return null;
};

/**
 * Super admin (5) / staff (6): any franchise.
 * Franchise admin (1): own franchise_id or franchises they admin.
 * Employee (3): own franchise_id only.
 */
const assertFranchiseAccess = async (authUser, franchiseOid) => {
    if (!authUser?.id) {
        return { ok: false, status: 401, message: 'Unauthorized.' };
    }

    const caller = await User.findOne({ _id: authUser.id, deleted_at: null })
        .select('type franchise_id')
        .lean();
    if (!caller) {
        return { ok: false, status: 401, message: 'User not found.' };
    }

    const fr = await Franchise.findOne({ _id: franchiseOid, deleted_at: null }).select('admin_id').lean();
    if (!fr) {
        return { ok: false, status: 404, message: 'Franchise not found.' };
    }

    const ft = Number(caller.type);
    if (ft === 5 || ft === 6) {
        return { ok: true };
    }
    if (ft === 1) {
        if (caller.franchise_id && caller.franchise_id.toString() === franchiseOid.toString()) {
            return { ok: true };
        }
        if (fr.admin_id && fr.admin_id.toString() === String(authUser.id)) {
            return { ok: true };
        }
        return {
            ok: false,
            status: 403,
            message: 'You are not allowed to view data for this franchise.',
        };
    }
    if (ft === 3) {
        if (caller.franchise_id && caller.franchise_id.toString() === franchiseOid.toString()) {
            return { ok: true };
        }
        return {
            ok: false,
            status: 403,
            message: 'You are not allowed to view data for this franchise.',
        };
    }
    return {
        ok: false,
        status: 403,
        message: 'You are not allowed to view data for this franchise.',
    };
};

module.exports = {
    parseFranchiseObjectId,
    pickFranchiseIdRaw,
    pickFranchiseIdFromReq,
    assertFranchiseAccess,
};

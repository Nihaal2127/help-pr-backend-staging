const mongoose = require('mongoose');
const { getFranchiseUserIdsForScope } = require('./franchise_catalog_dashboard_counts');

/**
 * Restrict catalogue list filters to pending requests raised by users under a franchise.
 * Used by GET /api/category|service/getAll (status=requested* / is_request=true).
 *
 * @param {object} filter — mutable Mongo filter
 * @param {mongoose.Types.ObjectId[]} franchiseIdsScope
 */
const applyRequestedByFranchiseScope = async (filter, franchiseIdsScope) => {
    const franchiseUserIds = await getFranchiseUserIdsForScope(franchiseIdsScope);
    filter.requested_by = franchiseUserIds.length > 0 ? { $in: franchiseUserIds } : { $in: [] };
};

/**
 * @param {object} caller — user lean doc with type, franchise_id
 * @param {object} query — req.query
 * @param {boolean} isRequestListing — true when listing pending requests (status=requested* / is_request=true)
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
const applyCatalogRequestScopeForCaller = async (filter, caller, query, isRequestListing) => {
    const USER_TYPE_ADMIN = 1;
    const USER_TYPE_SUPER_ADMIN = 5;
    const USER_TYPE_STAFF = 6;

    const shouldScope =
        caller.type === USER_TYPE_ADMIN ||
        (isRequestListing &&
            (caller.type === USER_TYPE_SUPER_ADMIN || caller.type === USER_TYPE_STAFF));

    if (caller.type === USER_TYPE_ADMIN) {
        if (!caller.franchise_id) {
            filter.requested_by = { $in: [] };
        } else {
            await applyRequestedByFranchiseScope(filter, [caller.franchise_id]);
        }
        return { ok: true };
    }

    if (
        shouldScope &&
        (caller.type === USER_TYPE_SUPER_ADMIN || caller.type === USER_TYPE_STAFF) &&
        query.franchise_id !== undefined &&
        query.franchise_id !== null &&
        String(query.franchise_id).trim() !== ''
    ) {
        const pick = String(query.franchise_id).trim();
        if (!mongoose.Types.ObjectId.isValid(pick)) {
            return { ok: false, status: 409, message: 'Invalid franchise id.' };
        }
        await applyRequestedByFranchiseScope(filter, [new mongoose.Types.ObjectId(pick)]);
    }

    return { ok: true };
};

module.exports = {
    applyRequestedByFranchiseScope,
    applyCatalogRequestScopeForCaller,
};

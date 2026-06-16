const mongoose = require('mongoose');
const { fieldLabel } = require('../utils/field_labels');
const PartnerSubscription = require('../models/partner_subscription');
const SubscriptionPlan = require('../models/subscription_plan');
const User = require('../models/user');
const {
    parseFranchiseObjectId,
    pickFranchiseIdFromReq,
    assertFranchiseAccess,
} = require('../utils/franchise_access');
const { loadFranchiseCallerScope } = require('../utils/franchise_user_scope');
const {
    safeNotifySubscriptionAssigned,
    safeNotifySubscriptionStatusChanged,
} = require('../src/modules/notifications/services/domainHooks');
/** Same as `user.type` in models/user.js (2 = Partner). */
const USER_TYPE_PARTNER = 2;

const parseObjectId = (raw, fieldName = 'id') => {
    if (raw instanceof mongoose.Types.ObjectId) {
        return { ok: true, oid: raw };
    }
    const s = raw !== undefined && raw !== null ? String(raw).trim() : '';
    if (!s || !/^[a-fA-F0-9]{24}$/.test(s)) {
        return {
            ok: false,
            message: `${fieldLabel(fieldName)} must be a valid MongoDB ObjectId (24 hex characters).`,
        };
    }
    return { ok: true, oid: new mongoose.Types.ObjectId(s) };
};

const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });
const ok = (status, data) => ({ ok: true, status, data });

const computeExpiresAt = (startDate, plan) => {
    const start = new Date(startDate);
    const d = new Date(start);
    const n = plan.duration;
    if (plan.duration_type === 'days') {
        d.setDate(d.getDate() + n);
    } else {
        d.setMonth(d.getMonth() + n);
    }
    return d;
};

const cancelActiveForPartner = async (partnerOid, session = null) => {
    const q = PartnerSubscription.updateMany(
        { partner_id: partnerOid, status: 'active', deleted_at: null },
        { $set: { status: 'cancelled', updated_at: new Date() } }
    );
    if (session) await q.session(session);
    else await q;
};

const loadPartnerUser = async (partnerOid) => {
    const user = await User.findOne({
        _id: partnerOid,
        type: USER_TYPE_PARTNER,
        deleted_at: null,
    }).select('_id name email type');
    return user;
};

const loadActivePlan = async (planOid) => {
    return SubscriptionPlan.findOne({
        _id: planOid,
        deleted_at: null,
        is_active: true,
    });
};

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseOptionalDateQuery = (raw, fieldName) => {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return { ok: true, instant: null };
    }
    const s = String(raw).trim();
    const dateOnly = s.match(DATE_ONLY_RE);
    if (dateOnly) {
        const instant = new Date(
            Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
        );
        if (Number.isNaN(instant.getTime())) {
            return { ok: false, message: `${fieldLabel(fieldName)} must be a valid date.` };
        }
        return { ok: true, instant };
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
        return { ok: false, message: `${fieldLabel(fieldName)} must be a valid date.` };
    }
    return { ok: true, instant: d };
};

const startOfUtcDay = (instant) => {
    const x = new Date(instant);
    x.setUTCHours(0, 0, 0, 0);
    return x;
};

const endOfUtcDay = (instant) => {
    const x = new Date(instant);
    x.setUTCHours(23, 59, 59, 999);
    return x;
};

const buildUtcDayRangeCondition = (fromStart, toEnd) => {
    if (fromStart && toEnd) {
        return { $gte: fromStart, $lte: toEnd };
    }
    if (fromStart) {
        return { $gte: fromStart };
    }
    if (toEnd) {
        return { $lte: toEnd };
    }
    return null;
};

/** Both started_at and expires_at must fall within the UTC day range. */
const applySubscriptionDateRangeFilter = (match, fromStart, toEnd) => {
    const cond = buildUtcDayRangeCondition(fromStart, toEnd);
    if (!cond) {
        return;
    }
    match.started_at = { ...cond };
    match.expires_at = { ...cond };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const emptyPartnerSubscriptionList = (page) =>
    ok(200, {
        message: 'Partner subscription list fetched successfully.',
        totalItems: 0,
        totalPages: 0,
        currentPage: page,
        records: [],
    });

/**
 * Franchise scope for GET list — aligned with user-management / getCount type 12.
 * Super admin: optional franchise_id (query, body, or headers); omit = all franchises.
 * Franchise admin: always scoped to their franchise (sent id must match if provided).
 */
const resolveListFranchiseScope = async (req) => {
    if (!req?.user?.id) {
        return { ok: true, franchiseOid: null };
    }

    const raw = pickFranchiseIdFromReq(req);
    let franchiseOid = null;

    if (raw) {
        const parsed = parseFranchiseObjectId(raw, 'franchise_id');
        if (!parsed.ok) {
            return { ok: false, status: 409, message: 'Invalid franchise id.' };
        }
        franchiseOid = parsed.oid;
        const access = await assertFranchiseAccess(req.user, franchiseOid);
        if (!access.ok) {
            return { ok: false, status: access.status, message: access.message };
        }
        return { ok: true, franchiseOid };
    }

    const callerScope = await loadFranchiseCallerScope(req.user.id);
    if (callerScope?.isFranchiseStaff && callerScope.franchiseOid) {
        franchiseOid = callerScope.franchiseOid;
    }

    return { ok: true, franchiseOid };
};

const restrictPartnerIds = (match, candidateIds) => {
    if (!candidateIds.length) {
        return false;
    }
    const candidateSet = new Set(candidateIds.map((id) => String(id)));

    if (!match.partner_id) {
        match.partner_id = { $in: candidateIds };
        return true;
    }

    let existingIds;
    if (match.partner_id instanceof mongoose.Types.ObjectId) {
        existingIds = [String(match.partner_id)];
    } else if (match.partner_id.$in) {
        existingIds = match.partner_id.$in.map((id) => String(id));
    } else {
        existingIds = [String(match.partner_id)];
    }

    const intersected = existingIds.filter((id) => candidateSet.has(id));
    if (!intersected.length) {
        return false;
    }
    if (intersected.length === 1) {
        match.partner_id = new mongoose.Types.ObjectId(intersected[0]);
    } else {
        match.partner_id = {
            $in: intersected.map((id) => new mongoose.Types.ObjectId(id)),
        };
    }
    return true;
};

const listPartnerSubscriptions = async (query, req = null) => {
    try {
        const page = parseInt(query.page, 10) || 1;
        const limit = parseInt(query.limit, 10) || 10;
        const skip = (page - 1) * limit;
        const match = { deleted_at: null };

        if (req) {
            const franchiseScope = await resolveListFranchiseScope(req);
            if (!franchiseScope.ok) {
                return fail(franchiseScope.status, franchiseScope.message);
            }
            if (franchiseScope.franchiseOid) {
                const franchisePartnerIds = await User.find({
                    type: USER_TYPE_PARTNER,
                    franchise_id: franchiseScope.franchiseOid,
                    deleted_at: null,
                }).distinct('_id');
                if (!restrictPartnerIds(match, franchisePartnerIds)) {
                    return emptyPartnerSubscriptionList(page);
                }
            }
        }

        if (query.status && ['active', 'expired', 'cancelled'].includes(query.status)) {
            match.status = query.status;
        }
        if (query.partner_id) {
            const p = parseObjectId(query.partner_id, 'partner_id');
            if (!p.ok) return fail(400, p.message);
            match.partner_id = p.oid;
        }
        if (query.subscription_plan_id) {
            const p = parseObjectId(query.subscription_plan_id, 'subscription_plan_id');
            if (!p.ok) return fail(400, p.message);
            match.subscription_plan_id = p.oid;
        }

        const rawPlanName = query.plan_name ?? query.subscription_plan;
        if (
            rawPlanName !== undefined &&
            rawPlanName !== null &&
            String(rawPlanName).trim() !== ''
        ) {
            const planName = String(rawPlanName).trim().toLowerCase();
            if (!SubscriptionPlan.PLAN_NAMES.includes(planName)) {
                return fail(
                    400,
                    `plan_name must be one of: ${SubscriptionPlan.PLAN_NAMES.join(', ')}.`
                );
            }
            const planIds = await SubscriptionPlan.find({
                plan_name: planName,
                deleted_at: null,
            }).distinct('_id');
            if (!planIds.length) {
                return emptyPartnerSubscriptionList(page);
            }
            if (match.subscription_plan_id) {
                const fixedPlanId = match.subscription_plan_id;
                const matchesPlan = planIds.some((id) => id.equals(fixedPlanId));
                if (!matchesPlan) {
                    return emptyPartnerSubscriptionList(page);
                }
            } else {
                match.subscription_plan_id = { $in: planIds };
            }
        }

        if (query.area_id) {
            const pArea = parseObjectId(query.area_id, 'area_id');
            if (!pArea.ok) return fail(400, pArea.message);
            const areaPartnerIds = await User.find({
                type: USER_TYPE_PARTNER,
                deleted_at: null,
                area_id: pArea.oid,
            }).distinct('_id');
            if (!restrictPartnerIds(match, areaPartnerIds)) {
                return emptyPartnerSubscriptionList(page);
            }
        }

        const fromRaw = query.from_date ?? query.start_date;
        const toRaw = query.to_date ?? query.end_date;
        const fromParsed = parseOptionalDateQuery(fromRaw, 'start_date');
        if (!fromParsed.ok) return fail(400, fromParsed.message);
        const toParsed = parseOptionalDateQuery(toRaw, 'end_date');
        if (!toParsed.ok) return fail(400, toParsed.message);

        const fromStart = fromParsed.instant ? startOfUtcDay(fromParsed.instant) : null;
        const toEnd = toParsed.instant ? endOfUtcDay(toParsed.instant) : null;

        if (fromStart && toEnd && fromStart.getTime() > toEnd.getTime()) {
            return fail(400, 'Start date must be on or before end date.');
        }

        applySubscriptionDateRangeFilter(match, fromStart, toEnd);

        const rawSearch = query.search ?? query.partner_name;
        if (rawSearch !== undefined && rawSearch !== null && String(rawSearch).trim() !== '') {
            const pattern = escapeRegex(String(rawSearch).trim());
            const matchedPartnerIds = await User.find({
                type: USER_TYPE_PARTNER,
                deleted_at: null,
                name: { $regex: pattern, $options: 'i' },
            }).distinct('_id');
            if (!restrictPartnerIds(match, matchedPartnerIds)) {
                return emptyPartnerSubscriptionList(page);
            }
        }

        const sortBy = query.sort_by != null ? String(query.sort_by).trim().toLowerCase() : '';
        const sortOrderAsc =
            query.sort_order !== undefined &&
            query.sort_order !== null &&
            (String(query.sort_order).toLowerCase() === 'asc' || String(query.sort_order) === '1');
        const so = sortOrderAsc ? 1 : -1;

        let sortStage = {};
        switch (sortBy) {
            case 'partner_name':
                sortStage = { 'partnerUser.name': so, _id: so };
                break;
            case 'subscription_plan':
                sortStage = { 'plan.plan_name': so, _id: so };
                break;
            case 'start_date':
                sortStage = { started_at: so, _id: so };
                break;
            case 'end_date':
                sortStage = { expires_at: so, _id: so };
                break;
            default:
                sortStage = { created_at: query.sort !== undefined ? parseInt(query.sort, 10) : -1 };
                break;
        }

        const userColl = User.collection.collectionName;
        const planColl = SubscriptionPlan.collection.collectionName;

        const pipeline = [
            { $match: match },
            {
                $lookup: {
                    from: userColl,
                    localField: 'partner_id',
                    foreignField: '_id',
                    as: 'partnerUser',
                },
            },
            { $unwind: { path: '$partnerUser', preserveNullAndEmptyArrays: false } },
            {
                $lookup: {
                    from: planColl,
                    localField: 'subscription_plan_id',
                    foreignField: '_id',
                    as: 'plan',
                },
            },
            { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: userColl,
                    localField: 'assigned_by_id',
                    foreignField: '_id',
                    as: 'assignedByUser',
                },
            },
            { $unwind: { path: '$assignedByUser', preserveNullAndEmptyArrays: true } },
            { $sort: sortStage },
            {
                $facet: {
                    data: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $addFields: {
                                partner_id: {
                                    _id: '$partnerUser._id',
                                    name: '$partnerUser.name',
                                    email: '$partnerUser.email',
                                    phone_number: '$partnerUser.phone_number',
                                },
                                subscription_plan_id: '$plan',
                                assigned_by_id: {
                                    $cond: [
                                        { $ne: [{ $ifNull: ['$assignedByUser', null] }, null] },
                                        {
                                            _id: '$assignedByUser._id',
                                            name: '$assignedByUser.name',
                                            email: '$assignedByUser.email',
                                        },
                                        null,
                                    ],
                                },
                            },
                        },
                        {
                            $project: {
                                partnerUser: 0,
                                plan: 0,
                                assignedByUser: 0,
                            },
                        },
                    ],
                    totalCount: [{ $count: 'totalCount' }],
                },
            },
        ];

        const aggResult = await PartnerSubscription.aggregate(pipeline).collation({
            locale: 'en',
            strength: 2,
        });
        const facet = aggResult[0] || { data: [], totalCount: [] };
        const rows = facet.data || [];
        const totalCount = facet.totalCount[0] ? facet.totalCount[0].totalCount : 0;
        const totalPages = Math.ceil(totalCount / limit);

        return ok(200, {
            message: 'Partner subscription list fetched successfully.',
            totalItems: totalCount,
            totalPages,
            currentPage: page,
            records: rows,
        });
    } catch (err) {
        console.log('listPartnerSubscriptions', err.message);
        return fail(500, 'Internal server error.');
    }
};

const createPartnerSubscription = async (body, assignedByUserId) => {
    try {
        const { partner_id, subscription_plan_id, started_at, expires_at, notes, status } = body;

        const pPartner = parseObjectId(partner_id, 'partner_id');
        if (!pPartner.ok) return fail(400, pPartner.message);
        const pPlan = parseObjectId(subscription_plan_id, 'subscription_plan_id');
        if (!pPlan.ok) return fail(400, pPlan.message);

        const partnerUser = await loadPartnerUser(pPartner.oid);
        if (!partnerUser) {
            return fail(404, 'Partner not found or user is not a partner.');
        }

        const plan = await loadActivePlan(pPlan.oid);
        if (!plan) {
            return fail(404, 'Subscription plan not found, inactive, or deleted.');
        }

        const start = started_at ? new Date(started_at) : new Date();
        if (Number.isNaN(start.getTime())) {
            return fail(400, `${fieldLabel('started_at')} must be a valid date.`);
        }

        let endDate = null;
        if (expires_at !== undefined && expires_at !== null && expires_at !== '') {
            endDate = new Date(expires_at);
            if (Number.isNaN(endDate.getTime())) {
                return fail(400, `${fieldLabel('expires_at')} must be a valid date.`);
            }
        } else {
            endDate = computeExpiresAt(start, plan);
        }

        const assignedBy =
            assignedByUserId !== undefined && assignedByUserId !== null
                ? parseObjectId(assignedByUserId, 'assigned_by_id')
                : null;
        let assignedOid = null;
        if (assignedBy && assignedBy.ok) {
            assignedOid = assignedBy.oid;
        }

        let requestedStatus = String(status === undefined || status === null ? 'active' : status).toLowerCase();
        if (requestedStatus === '1') requestedStatus = 'active';
        const normalizedStatus = requestedStatus === 'inactive' ? 'cancelled' : requestedStatus;
        if (!['active', 'expired', 'cancelled'].includes(normalizedStatus)) {
            return fail(400, 'status must be active, expired, or cancelled.');
        }

        // Maintain only one active subscription row per partner:
        // update existing row; create only if partner has no row yet.
        const existingRows = await PartnerSubscription.find({
            partner_id: pPartner.oid,
            deleted_at: null,
        })
            .sort({ updated_at: -1, created_at: -1 })
            .select('_id');

        const primary = existingRows[0] || new PartnerSubscription({ partner_id: pPartner.oid });
        primary.subscription_plan_id = pPlan.oid;
        primary.started_at = start;
        primary.expires_at = endDate;
        primary.status = normalizedStatus;
        primary.assigned_by_id = assignedOid;
        primary.notes = notes !== undefined && notes !== null ? String(notes) : '';
        primary.updated_at = new Date();
        if (!primary.created_at) {
            primary.created_at = new Date();
        }

        const saved = await primary.save();

        // Soft-delete any extra rows to enforce single-row policy.
        if (existingRows.length > 1) {
            await PartnerSubscription.updateMany(
                {
                    partner_id: pPartner.oid,
                    deleted_at: null,
                    _id: { $ne: saved._id },
                },
                { $set: { deleted_at: new Date(), updated_at: new Date() } }
            );
        }
        const populated = await PartnerSubscription.findById(saved._id)
            .populate('partner_id', 'name email phone_number')
            .populate('subscription_plan_id')
            .populate('assigned_by_id', 'name email');

        void safeNotifySubscriptionAssigned({
            subscription: populated,
            planName: plan?.plan_name || '',
            actorUserId: assignedByUserId || null,
        });

        return ok(200, {
            message: 'Partner subscription assigned successfully.',
            record: populated,
        });
    } catch (error) {
        console.error('createPartnerSubscription', error.message);
        return fail(500, 'Internal server error.');
    }
};

const updatePartnerSubscription = async (id, body) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const row = await PartnerSubscription.findOne({ _id: pId.oid, deleted_at: null });
        if (!row) return fail(404, 'No record found');

        const previousStatus = row.status;

        if (body.subscription_plan_id !== undefined) {
            const pPlan = parseObjectId(body.subscription_plan_id, 'subscription_plan_id');
            if (!pPlan.ok) return fail(400, pPlan.message);
            const plan = await loadActivePlan(pPlan.oid);
            if (!plan) {
                return fail(404, 'Subscription plan not found, inactive, or deleted.');
            }
            row.subscription_plan_id = pPlan.oid;
        }

        if (body.started_at !== undefined) {
            const d = new Date(body.started_at);
            if (Number.isNaN(d.getTime())) return fail(400, `${fieldLabel('started_at')} must be a valid date.`);
            row.started_at = d;
        }

        if (body.expires_at !== undefined) {
            if (body.expires_at === null || body.expires_at === '') {
                row.expires_at = null;
            } else {
                const d = new Date(body.expires_at);
                if (Number.isNaN(d.getTime())) return fail(400, `${fieldLabel('expires_at')} must be a valid date.`);
                row.expires_at = d;
            }
        }

        if (body.status !== undefined) {
            if (!['active', 'expired', 'cancelled'].includes(body.status)) {
                return fail(400, 'status must be active, expired, or cancelled.');
            }
            row.status = body.status;
        }

        if (body.notes !== undefined) {
            row.notes = body.notes !== null ? String(body.notes) : '';
        }

        row.updated_at = new Date();
        await row.save();

        const populated = await PartnerSubscription.findById(row._id)
            .populate('partner_id', 'name email phone_number')
            .populate('subscription_plan_id')
            .populate('assigned_by_id', 'name email');

        if (body.status !== undefined && row.status !== previousStatus) {
            void safeNotifySubscriptionStatusChanged({
                subscription: populated,
                previousStatus,
                newStatus: row.status,
                planName: populated?.subscription_plan_id?.plan_name || '',
                actorUserId: null,
            });
        }

        return ok(200, { message: 'Partner subscription updated successfully', record: populated });
    } catch (error) {
        console.error('updatePartnerSubscription', error.message);
        return fail(500, 'Internal server error.');
    }
};

const getPartnerSubscriptionById = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const record = await PartnerSubscription.findOne({ _id: pId.oid, deleted_at: null })
            .populate('partner_id', 'name email phone_number')
            .populate('subscription_plan_id')
            .populate('assigned_by_id', 'name email');
        if (!record) return fail(404, 'No record found');
        return ok(200, { message: 'Partner subscription fetched successfully', record });
    } catch (error) {
        console.error('getPartnerSubscriptionById', error);
        return fail(500, 'Internal server error.');
    }
};

const softDeletePartnerSubscription = async (id) => {
    try {
        const pId = parseObjectId(id, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const row = await PartnerSubscription.findById(pId.oid);
        if (!row) return fail(404, 'No record found');
        if (row.deleted_at) return fail(400, 'Record is already deleted');

        row.deleted_at = new Date();
        await row.save();
        return ok(200, { message: 'Partner subscription deleted successfully' });
    } catch (error) {
        console.error('softDeletePartnerSubscription', error);
        return fail(500, 'Internal server error.');
    }
};

const importPartnerSubscriptions = async (records, assignedByUserId) => {
    if (!records || !Array.isArray(records)) {
        return fail(400, 'Invalid input. Expected an array of records.');
    }
    if (records.length === 0) {
        return fail(400, 'Please add records in excel sheet.');
    }

    try {
        const assignedBy =
            assignedByUserId !== undefined && assignedByUserId !== null
                ? parseObjectId(assignedByUserId, 'assigned_by_id')
                : null;
        const assignedOid = assignedBy && assignedBy.ok ? assignedBy.oid : null;

        const createdIds = [];
        for (const rec of records) {
            if (!rec.partner_id || !rec.subscription_plan_id) {
                return fail(400, 'Each record must include partner and subscription plan.');
            }

            const pPartner = parseObjectId(rec.partner_id, 'partner_id');
            if (!pPartner.ok) return fail(400, pPartner.message);
            const pPlan = parseObjectId(rec.subscription_plan_id, 'subscription_plan_id');
            if (!pPlan.ok) return fail(400, pPlan.message);

            const partnerUser = await loadPartnerUser(pPartner.oid);
            if (!partnerUser) {
                return fail(404, `Partner not found or not a partner.`);
            }

            const plan = await loadActivePlan(pPlan.oid);
            if (!plan) {
                return fail(404, `Subscription plan not found or inactive.`);
            }

            const start = rec.started_at ? new Date(rec.started_at) : new Date();
            if (Number.isNaN(start.getTime())) {
                return fail(400, `Invalid start date for partner.`);
            }

            let endDate = null;
            if (rec.expires_at !== undefined && rec.expires_at !== null && rec.expires_at !== '') {
                endDate = new Date(rec.expires_at);
                if (Number.isNaN(endDate.getTime())) {
                    return fail(400, `Invalid expiry date for partner.`);
                }
            } else {
                endDate = computeExpiresAt(start, plan);
            }

            await cancelActiveForPartner(pPartner.oid);

            const doc = await PartnerSubscription.create({
                partner_id: pPartner.oid,
                subscription_plan_id: pPlan.oid,
                started_at: start,
                expires_at: endDate,
                status: 'active',
                assigned_by_id: assignedOid,
                notes: rec.notes !== undefined && rec.notes !== null ? String(rec.notes) : '',
            });
            createdIds.push(doc._id);
        }

        const inserted = await PartnerSubscription.find({
            _id: { $in: createdIds },
        })
            .populate('partner_id', 'name email phone_number')
            .populate('subscription_plan_id')
            .populate('assigned_by_id', 'name email');

        return ok(200, {
            message: `${records.length} partner subscription(s) assigned successfully!`,
            records: inserted,
        });
    } catch (error) {
        console.log('importPartnerSubscriptions', error.message);
        return fail(500, 'Internal server error.', { error: error.message });
    }
};

const getMySubscription = async (partnerUserId) => {
    try {
        const pId = parseObjectId(partnerUserId, 'id');
        if (!pId.ok) return fail(400, pId.message);

        const partnerUser = await loadPartnerUser(pId.oid);
        if (!partnerUser) {
            return fail(403, 'Only partner accounts can view this resource.');
        }

        const now = new Date();
        const record = await PartnerSubscription.findOne({
            partner_id: pId.oid,
            status: 'active',
            deleted_at: null,
            $or: [{ expires_at: null }, { expires_at: { $gt: now } }],
        })
            .sort({ created_at: -1 })
            .populate('subscription_plan_id')
            .populate('assigned_by_id', 'name email');

        if (!record) {
            return ok(200, {
                message: 'No active subscription found.',
                record: null,
            });
        }

        return ok(200, {
            message: 'Partner subscription fetched successfully',
            record,
        });
    } catch (error) {
        console.error('getMySubscription', error);
        return fail(500, 'Internal server error.');
    }
};

module.exports = {
    listPartnerSubscriptions,
    createPartnerSubscription,
    updatePartnerSubscription,
    getPartnerSubscriptionById,
    softDeletePartnerSubscription,
    importPartnerSubscriptions,
    getMySubscription,
};

const mongoose = require('mongoose');
const Quote = require('../../../models/quote');
const { applyPagination } = require('../../../utils/pagination');
const {
  attachPartnerServiceToQuote,
  attachPartnerServiceToQuotes,
} = require('../../../utils/quote_partner_service');
const {
  resolveQuoteStatus,
  canTransitionQuoteStatus,
  normalizeQuoteStatus,
  formatQuoteForApi,
  formatQuoteRecords,
  TERMINAL_QUOTE_STATUSES,
} = require('../../../enum/quote_status_enum');
const {
  assertPartnerAssignedToQuote,
  toObjectId,
} = require('../../../utils/mobile_quote_access');
const { QUOTE_MOBILE_DETAIL_POPULATE } = require('../../../utils/mobile_quote_constants');
const {
  buildHistoryChange,
  appendQuoteHistory,
} = require('../../../utils/quote_history_helper');
const { safeNotifyQuoteStatusChanged } = require('../../../src/modules/notifications/services/domainHooks');
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');

const formatMobileQuoteForApi = (quote) =>
  stripAdminDescriptionForPublicApi(formatQuoteForApi(quote));
const formatMobileQuoteRecords = (records) =>
  formatQuoteRecords(records).map(stripAdminDescriptionForPublicApi);

const { fail, ok, parsePositiveInt } = require('../../../utils/mobile_service_result');

const DEFAULT_LIST_STATUSES = ['pending', 'accepted'];

const buildPartnerListFilter = (partnerId, query) => {
  const filter = {
    deleted_at: null,
    partner_id: toObjectId(partnerId),
  };

  const statusRaw = query.status;
  if (statusRaw !== undefined && String(statusRaw).trim() !== '') {
    const normalized = normalizeQuoteStatus(String(statusRaw).trim());
    if (normalized) {
      filter.status = normalized;
    }
  } else {
    filter.status = { $in: DEFAULT_LIST_STATUSES };
  }

  return filter;
};

const listPartnerQuotes = async (partnerId, query) => {
  try {
    const page = parsePositiveInt(query.page, 1);
    const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
    const filter = buildPartnerListFilter(partnerId, query);
    const sort = { updated_at: -1, created_at: -1 };

    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      Quote,
      filter,
      page,
      limit,
      sort,
      {},
      QUOTE_MOBILE_DETAIL_POPULATE
    );

    await attachPartnerServiceToQuotes(data);

    return ok(200, {
      message: 'Quotes fetched successfully.',
      data: {
        totalItems: totalCount,
        totalPages,
        currentPage,
        limit,
        records: formatMobileQuoteRecords(data),
      },
    });
  } catch (err) {
    console.error('mobile partner list quotes', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getPartnerQuoteById = async (partnerId, quoteId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null })
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();

    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertPartnerAssignedToQuote(partnerId, quote);
    if (!access.ok) return access;

    await attachPartnerServiceToQuote(quote);

    return ok(200, {
      message: 'Quote fetched successfully.',
      data: formatMobileQuoteForApi(quote),
    });
  } catch (err) {
    console.error('mobile partner get quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const applyPartnerStatusSideEffects = (quote, body, nextStatus) => {
  if (nextStatus === 'failed') {
    if (body.rejection_reason !== undefined) {
      quote.rejection_reason = String(body.rejection_reason).trim();
    }
    if (body.cancellation_reason !== undefined) {
      quote.cancellation_reason = String(body.cancellation_reason).trim();
    }
  }
};

const updatePartnerQuoteStatus = async (partnerId, quoteId, body) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }

    const nextStatus = normalizeQuoteStatus(body.status);
    if (!nextStatus) {
      return fail(409, 'Invalid status.');
    }

    if (!['accepted', 'failed'].includes(nextStatus)) {
      return fail(
        409,
        'Partners can only set status to accepted or failed.'
      );
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertPartnerAssignedToQuote(partnerId, quote);
    if (!access.ok) return access;

    const currentStatus = resolveQuoteStatus(quote);

    if (TERMINAL_QUOTE_STATUSES.has(currentStatus)) {
      return fail(
        409,
        `Quotes with status "${currentStatus}" cannot be changed.`
      );
    }

    if (!canTransitionQuoteStatus(currentStatus, nextStatus)) {
      return fail(
        409,
        `Cannot change quote status from "${currentStatus}" to "${nextStatus}".`
      );
    }

    if (currentStatus !== 'pending') {
      return fail(409, 'Only pending quotes can be accepted or rejected by the partner.');
    }

    const oldStatus = quote.status;
    const oldRejection = quote.rejection_reason;
    const oldCancellation = quote.cancellation_reason;

    applyPartnerStatusSideEffects(quote, body, nextStatus);
    quote.status = nextStatus;

    const historyChanges = [
      buildHistoryChange('status', oldStatus, quote.status),
    ];

    if (nextStatus === 'failed') {
      historyChanges.push(
        buildHistoryChange('rejection_reason', oldRejection, quote.rejection_reason),
        buildHistoryChange(
          'cancellation_reason',
          oldCancellation,
          quote.cancellation_reason
        )
      );
    }

    quote.updated_at = new Date();
    appendQuoteHistory(quote, {
      actorId: partnerId,
      actorRole: 'partner',
      eventType: 'status_updated',
      changes: historyChanges.filter(Boolean),
      notes:
        nextStatus === 'accepted'
          ? 'Quote accepted by partner.'
          : 'Quote rejected by partner.',
    });

    await quote.save();

    void safeNotifyQuoteStatusChanged({
      quote,
      previousStatus: oldStatus,
      newStatus: quote.status,
      actorUserId: partnerId,
    });

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message:
        nextStatus === 'accepted'
          ? 'Quote accepted successfully.'
          : 'Quote updated successfully.',
      data: formatMobileQuoteForApi(populated),
    });
  } catch (err) {
    console.error('mobile partner update quote status', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listPartnerQuotes,
  getPartnerQuoteById,
  updatePartnerQuoteStatus,
};

const mongoose = require('mongoose');
const Quote = require('../../../models/quote');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { getQuoteSequenceId } = require('../../../helper/id_generator');
const { checkObjectIdExists } = require('../../../validator/id_validator');
const { applyPagination } = require('../../../utils/pagination');
const { OrderCreationError } = require('../../../errors/order_creation_error');
const OrderPayment = require('../../../models/order_payment');
const {
  resolveQuotePricing,
  applyPricingToQuote,
  quotePricingInputChanged,
  buildQuotePricingBody,
} = require('../../quote_pricing_service');
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
  assertCustomerOwnsQuote,
  assertFranchiseExists,
  assertCustomerOwnsAddress,
  assertPartnerUser,
  toObjectId,
} = require('../../../utils/mobile_quote_access');
const {
  QUOTE_MOBILE_DETAIL_POPULATE,
  CUSTOMER_QUOTE_FIELD_UPDATE_KEYS,
} = require('../../../utils/mobile_quote_constants');
const {
  buildHistoryChange,
  appendQuoteHistory,
} = require('../../../utils/quote_history_helper');
const {
  createOrderFromQuote,
} = require('../../order_creation_service');
const { syncOrderPaymentStatus } = require('../../order_payment_status_service');
const { syncAllPartnerOrderPaymentsForOrder } = require('../../partner_wallet_order_service');
const { formatOrderForApi } = require('../../../utils/order_api_format');

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data) => ({ ok: true, status, data });

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const applyCustomerQuoteFieldUpdates = (quote, body) => {
  const previousValues = {};

  for (const key of CUSTOMER_QUOTE_FIELD_UPDATE_KEYS) {
    if (body[key] !== undefined) {
      previousValues[key] = quote[key];
    }
  }

  for (const key of CUSTOMER_QUOTE_FIELD_UPDATE_KEYS) {
    if (body[key] === undefined) continue;

    if (['work_hours_per_day', 'total_work_hours'].includes(key)) {
      quote[key] = parseFloat(body[key]);
    } else if (key === 'quote_description') {
      quote.quote_description =
        typeof body[key] === 'string' ? body[key].trim() : '';
    } else if (key === 'partner_id' && (body[key] === null || body[key] === '')) {
      quote.partner_id = null;
    } else {
      quote[key] = body[key];
    }
  }

  return previousValues;
};

const validateRefsForCreate = async (customerId, body) => {
  const franchiseCheck = await assertFranchiseExists(body.franchise_id);
  if (!franchiseCheck.ok) return franchiseCheck;

  const addressCheck = await assertCustomerOwnsAddress(customerId, body.address_id);
  if (!addressCheck.ok) return addressCheck;

  const cat = await checkObjectIdExists(Category, body.category_id, 'category');
  if (!cat.exists) return fail(400, cat.message);

  const svc = await checkObjectIdExists(Service, body.service_id, 'service');
  if (!svc.exists) return fail(400, svc.message);

  if (
    body.partner_id !== undefined &&
    body.partner_id !== null &&
    String(body.partner_id).trim() !== ''
  ) {
    const partnerCheck = await assertPartnerUser(body.partner_id);
    if (!partnerCheck.ok) return partnerCheck;
  }

  return { ok: true, franchise: franchiseCheck.franchise };
};

const buildListFilter = (customerId, query) => {
  const filter = {
    deleted_at: null,
    user_id: toObjectId(customerId),
  };

  const franchiseId = query.franchise_id;
  if (franchiseId !== undefined && String(franchiseId).trim() !== '') {
    const oid = toObjectId(franchiseId);
    if (oid) filter.franchise_id = oid;
  }

  const statusRaw = query.status;
  if (statusRaw !== undefined && String(statusRaw).trim() !== '') {
    const normalized = normalizeQuoteStatus(String(statusRaw).trim());
    if (normalized) {
      filter.status = normalized;
    }
  }

  return filter;
};

const createCustomerQuote = async (customerId, body) => {
  try {
    const refCheck = await validateRefsForCreate(customerId, body);
    if (!refCheck.ok) return refCheck;

    let pricing;
    try {
      ({ pricing } = await resolveQuotePricing(body));
    } catch (pricingErr) {
      if (pricingErr instanceof OrderCreationError) {
        return fail(pricingErr.status, pricingErr.message);
      }
      throw pricingErr;
    }

    const hasPartner =
      body.partner_id !== undefined &&
      body.partner_id !== null &&
      String(body.partner_id).trim() !== '';

    const quote_sequence_id = await getQuoteSequenceId();
    const quote = new Quote({
      quote_sequence_id,
      user_id: customerId,
      partner_id: hasPartner ? body.partner_id : null,
      employee_id: null,
      created_by_id: customerId,
      category_id: body.category_id,
      service_id: body.service_id,
      franchise_id: body.franchise_id,
      address_id: body.address_id,
      status: hasPartner ? 'pending' : 'new',
      from_date: body.from_date,
      to_date: body.to_date,
      work_hours_per_day: parseFloat(body.work_hours_per_day),
      total_work_hours: parseFloat(body.total_work_hours),
      work_start_time: String(body.work_start_time).trim(),
      work_end_time: String(body.work_end_time).trim(),
      quote_description:
        typeof body.quote_description === 'string'
          ? body.quote_description.trim()
          : '',
    });

    applyPricingToQuote(quote, pricing);
    appendQuoteHistory(quote, {
      actorId: customerId,
      actorRole: 'customer',
      eventType: 'created',
      changes: [],
      notes: 'Quote created from customer app.',
    });

    await quote.save();

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote created successfully.',
      data: formatQuoteForApi(populated),
    });
  } catch (err) {
    console.error('mobile user create quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const listCustomerQuotes = async (customerId, query) => {
  try {
    const page = parsePositiveInt(query.page, 1);
    const limit = Math.min(parsePositiveInt(query.limit, 10), 50);
    const filter = buildListFilter(customerId, query);
    const sort = { created_at: -1 };

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
        records: formatQuoteRecords(data),
      },
    });
  } catch (err) {
    console.error('mobile user list quotes', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getCustomerQuoteById = async (customerId, quoteId) => {
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

    const access = assertCustomerOwnsQuote(customerId, quote);
    if (!access.ok) return access;

    await attachPartnerServiceToQuote(quote);

    return ok(200, {
      message: 'Quote fetched successfully.',
      data: formatQuoteForApi(quote),
    });
  } catch (err) {
    console.error('mobile user get quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const updateCustomerQuote = async (customerId, quoteId, body) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertCustomerOwnsQuote(customerId, quote);
    if (!access.ok) return access;

    const currentStatus = resolveQuoteStatus(quote);
    const hasFieldUpdates = CUSTOMER_QUOTE_FIELD_UPDATE_KEYS.some(
      (key) => body[key] !== undefined
    );

    if (!hasFieldUpdates) {
      return fail(409, 'No updatable fields provided.');
    }

    if (!['new', 'pending'].includes(currentStatus)) {
      return fail(
        409,
        'Only new or pending quotes can have their details updated.'
      );
    }

    if (body.address_id !== undefined) {
      const addressCheck = await assertCustomerOwnsAddress(customerId, body.address_id);
      if (!addressCheck.ok) return addressCheck;
    }

    if (body.partner_id !== undefined && body.partner_id !== null && body.partner_id !== '') {
      const partnerCheck = await assertPartnerUser(body.partner_id);
      if (!partnerCheck.ok) return partnerCheck;
    }

    if (body.category_id !== undefined) {
      const cat = await checkObjectIdExists(Category, body.category_id, 'category');
      if (!cat.exists) return fail(400, cat.message);
    }

    if (body.service_id !== undefined) {
      const svc = await checkObjectIdExists(Service, body.service_id, 'service');
      if (!svc.exists) return fail(400, svc.message);
    }

    const historyChanges = [];
    const previousValues = applyCustomerQuoteFieldUpdates(quote, body);

    if (quotePricingInputChanged({ service_id: body.service_id })) {
      try {
        const { pricing } = await resolveQuotePricing(
          buildQuotePricingBody(quote, { service_id: body.service_id })
        );
        const pricingBefore = {
          total_service_charge: quote.total_service_charge,
          commission_amount: quote.commission_amount,
          tax_amount: quote.tax_amount,
          sub_total: quote.sub_total,
          total_price: quote.total_price,
        };
        applyPricingToQuote(quote, pricing);
        for (const key of Object.keys(pricingBefore)) {
          const change = buildHistoryChange(key, pricingBefore[key], quote[key]);
          if (change) historyChanges.push(change);
        }
      } catch (pricingErr) {
        if (pricingErr instanceof OrderCreationError) {
          return fail(pricingErr.status, pricingErr.message);
        }
        throw pricingErr;
      }
    }

    for (const key of Object.keys(previousValues)) {
      const change = buildHistoryChange(key, previousValues[key], quote[key]);
      if (change) historyChanges.push(change);
    }

    if (currentStatus === 'new' && quote.partner_id) {
      historyChanges.push(buildHistoryChange('status', currentStatus, 'pending'));
      quote.status = 'pending';
    }

    quote.updated_at = new Date();

    if (historyChanges.length > 0) {
      appendQuoteHistory(quote, {
        actorId: customerId,
        actorRole: 'customer',
        eventType: 'updated',
        changes: historyChanges,
        notes: '',
      });
    }

    await quote.save();

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote updated successfully.',
      data: formatQuoteForApi(populated),
    });
  } catch (err) {
    console.error('mobile user update quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const cancelCustomerQuote = async (customerId, quoteId, body) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertCustomerOwnsQuote(customerId, quote);
    if (!access.ok) return access;

    const currentStatus = resolveQuoteStatus(quote);
    if (TERMINAL_QUOTE_STATUSES.has(currentStatus)) {
      return fail(409, `Quotes with status "${currentStatus}" cannot be cancelled.`);
    }

    if (!canTransitionQuoteStatus(currentStatus, 'failed')) {
      return fail(
        409,
        `Cannot cancel quote with status "${currentStatus}".`
      );
    }

    const oldStatus = quote.status;
    const oldCancellation = quote.cancellation_reason;

    quote.status = 'failed';
    if (body.cancellation_reason !== undefined) {
      quote.cancellation_reason = String(body.cancellation_reason).trim();
    }

    const historyChanges = [
      buildHistoryChange('status', oldStatus, quote.status),
      buildHistoryChange(
        'cancellation_reason',
        oldCancellation,
        quote.cancellation_reason
      ),
    ].filter(Boolean);

    quote.updated_at = new Date();
    appendQuoteHistory(quote, {
      actorId: customerId,
      actorRole: 'customer',
      eventType: 'status_updated',
      changes: historyChanges,
      notes: 'Quote cancelled by customer.',
    });

    await quote.save();

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote cancelled successfully.',
      data: formatQuoteForApi(populated),
    });
  } catch (err) {
    console.error('mobile user cancel quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const convertCustomerQuoteToOrder = async (customerId, quoteId, body) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertCustomerOwnsQuote(customerId, quote);
    if (!access.ok) return access;

    const currentStatus = resolveQuoteStatus(quote);
    if (currentStatus !== 'accepted') {
      return fail(409, 'Only accepted quotes can be converted to order.');
    }
    if (quote.order_id) {
      return fail(409, 'Quote is already linked to an order.');
    }

    const minimumDeposit = Number(quote.minimum_deposit_amount) || 0;
    const totalPrice = Number(quote.total_price) || 0;
    const paidAmount = Number(body.amount);

    if (paidAmount < minimumDeposit) {
      return fail(
        409,
        `Minimum deposit is ${minimumDeposit}. Amount must be at least minimum_deposit_amount.`
      );
    }
    if (totalPrice > 0 && paidAmount > totalPrice) {
      return fail(409, 'Amount cannot exceed quote total_price.');
    }

    let created;
    try {
      created = await createOrderFromQuote(quote);
    } catch (error) {
      if (error instanceof OrderCreationError) {
        return fail(error.status, error.message);
      }
      throw error;
    }

    const paymentStatus = body.payment_status ? String(body.payment_status).trim() : 'completed';
    const allowedPaymentStatuses = new Set(['pending', 'completed']);
    if (!allowedPaymentStatuses.has(paymentStatus)) {
      return fail(400, 'payment_status must be either pending or completed.');
    }

    const orderPayment = new OrderPayment({
      order_id: created.order._id,
      payer_type: 'customer',
      amount: paidAmount,
      payment_method: String(body.payment_method || '').trim(),
      status: paymentStatus,
      transaction_reference: body.transaction_reference
        ? String(body.transaction_reference).trim()
        : '',
      paid_at:
        body.paid_at !== undefined && body.paid_at !== null && body.paid_at !== ''
          ? new Date(body.paid_at)
          : paymentStatus === 'completed'
            ? new Date()
            : null,
      notes: body.notes ? String(body.notes).trim() : '',
    });
    await orderPayment.save();

    await syncOrderPaymentStatus(created.order._id);
    await syncAllPartnerOrderPaymentsForOrder(created.order._id);

    const linkedQuote = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(linkedQuote);

    return ok(200, {
      message: 'Quote converted to order successfully.',
      data: {
        quote: formatQuoteForApi(linkedQuote),
        order: formatOrderForApi(created.order),
        payment: orderPayment.toObject(),
        deposit: {
          minimum_deposit_amount: minimumDeposit,
          paid_amount: paidAmount,
          remaining_deposit_due: Math.max(0, minimumDeposit - paidAmount),
        },
      },
    });
  } catch (err) {
    console.error('mobile user convert quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  createCustomerQuote,
  listCustomerQuotes,
  getCustomerQuoteById,
  updateCustomerQuote,
  cancelCustomerQuote,
  convertCustomerQuoteToOrder,
};

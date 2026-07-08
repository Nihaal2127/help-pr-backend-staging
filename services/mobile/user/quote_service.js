const mongoose = require('mongoose');
const Quote = require('../../../models/quote');
const Category = require('../../../models/category');
const Service = require('../../../models/service');
const { getQuoteSequenceId } = require('../../../helper/id_generator');
const { checkObjectIdExists } = require('../../../validator/id_validator');
const { applyPagination } = require('../../../utils/pagination');
const { OrderCreationError } = require('../../../errors/order_creation_error');
const OrderPayment = require('../../../models/order_payment');
const Order = require('../../../models/order');
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
  safeNotifyQuoteCreated,
  safeNotifyQuoteStatusChanged,
  safeNotifyQuoteAssigned,
  safeNotifyOrderPaymentReceived,
} = require('../../../src/modules/notifications/services/domainHooks');
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
const { stripAdminDescriptionForPublicApi } = require('../../../utils/admin_description_access');

const formatMobileQuoteForApi = (quote) =>
  stripAdminDescriptionForPublicApi(formatQuoteForApi(quote));
const formatMobileQuoteRecords = (records) =>
  formatQuoteRecords(records).map(stripAdminDescriptionForPublicApi);
const formatMobileOrderForApi = (order) =>
  stripAdminDescriptionForPublicApi(formatOrderForApi(order));
const {
  loadCustomerProfile,
  initiateQuoteDepositPayment,
  syncPendingQuoteDepositPayment,
  hasPendingQuoteDepositPayment,
  buildQuoteDepositSummary,
} = require('../../../src/modules/payments/services/quoteDepositPayment.service');
const { fetchPaymentLink } = require('../../../src/modules/payments/razorpay.client');
const GatewayPayment = require('../../../models/gateway_payment');
const {
  PAYMENT_PURPOSES,
  GATEWAY_PAYMENT_METHOD,
} = require('../../../src/modules/payments/constants/payment.constants');
const { RAZORPAY_LINK_RESUMABLE } = require('../../../src/modules/payments/services/orderOnlinePayment.service');
const { escapeRegExp } = require('../../../utils/string_helpers');
const {
  buildQuoteDateRangeFilter,
  buildQuoteTodayOverlapFilter,
} = require('../../../utils/schedule_date_filters');

const { fail, ok, parsePositiveInt } = require('../../../utils/mobile_service_result');

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

const buildCustomerQuotesListFilter = (customerId, query) => {
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

  const searchRaw = query.search ?? query.q;
  if (searchRaw !== undefined && String(searchRaw).trim() !== '') {
    const search = String(searchRaw).trim();
    const regex = new RegExp(escapeRegExp(search), 'i');
    filter.$or = [
      { quote_sequence_id: regex },
      { quote_description: regex },
      { cancellation_reason: regex },
      { rejection_reason: regex },
    ];
  }

  const dateRangeResult = buildQuoteDateRangeFilter(query);
  if (!dateRangeResult.ok) {
    return { ok: false, status: 409, message: dateRangeResult.message };
  }
  Object.assign(filter, dateRangeResult.filter);

  return { ok: true, filter };
};

const mergeMongoFilters = (...parts) => {
  const filters = parts.filter((part) => part && Object.keys(part).length > 0);
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
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

    void safeNotifyQuoteCreated({
      quote,
      actorUserId: customerId,
    });

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote created successfully.',
      data: formatMobileQuoteForApi(populated),
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
    const filterResult = buildCustomerQuotesListFilter(customerId, query);
    if (!filterResult.ok) {
      return fail(filterResult.status, filterResult.message);
    }
    const filter = filterResult.filter;
    const sort = { created_at: -1 };

    const todayOverlapResult = buildQuoteTodayOverlapFilter();
    const todayCountFilter = mergeMongoFilters(filter, todayOverlapResult.filter);

    const [{ data, totalCount, totalPages, currentPage }, todayCount] = await Promise.all([
      applyPagination(
        Quote,
        filter,
        page,
        limit,
        sort,
        {},
        QUOTE_MOBILE_DETAIL_POPULATE
      ),
      Quote.countDocuments(todayCountFilter),
    ]);

    await attachPartnerServiceToQuotes(data);

    return ok(200, {
      message: 'Quotes fetched successfully.',
      data: {
        totalItems: totalCount,
        todayCount,
        totalPages,
        currentPage,
        limit,
        records: formatMobileQuoteRecords(data),
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
      data: formatMobileQuoteForApi(quote),
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
    const previousStatus = currentStatus;
    let assignedPartner = false;

    if (quotePricingInputChanged(body)) {
      try {
        const { pricing } = await resolveQuotePricing(buildQuotePricingBody(quote, body));
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
      assignedPartner = true;
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

    if (assignedPartner) {
      void safeNotifyQuoteAssigned({
        quote,
        actorUserId: customerId,
      });
    } else if (quote.status !== previousStatus) {
      void safeNotifyQuoteStatusChanged({
        quote,
        previousStatus,
        newStatus: quote.status,
        actorUserId: customerId,
      });
    }

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote updated successfully.',
      data: formatMobileQuoteForApi(populated),
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

    if (await hasPendingQuoteDepositPayment(quote._id)) {
      return fail(
        409,
        'A pending online deposit payment exists for this quote. Wait for it to complete or expire before cancelling.'
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

    void safeNotifyQuoteStatusChanged({
      quote,
      previousStatus: oldStatus,
      newStatus: quote.status,
      actorUserId: customerId,
    });

    const populated = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(populated);

    return ok(200, {
      message: 'Quote cancelled successfully.',
      data: formatMobileQuoteForApi(populated),
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
    const quoteStatusBeforeConvert = currentStatus;

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

    const paymentMethod = String(body.payment_method || '').trim().toLowerCase();

    if (paymentMethod === 'online') {
      const profile = await loadCustomerProfile(customerId);
      if (!profile.ok) {
        return fail(profile.status, profile.message);
      }

      const onlineResult = await initiateQuoteDepositPayment({
        quote,
        customer: profile.user,
        amount: paidAmount,
        notes: body.notes ? String(body.notes).trim() : 'Quote deposit — Razorpay online payment',
        actorUserId: customerId,
      });

      if (!onlineResult.ok) {
        return fail(onlineResult.status, onlineResult.message);
      }

      let paymentRow = onlineResult.payment;
      let latestOrder = null;

      if (onlineResult.already_completed && onlineResult.order_id) {
        paymentRow = await OrderPayment.findById(paymentRow._id).lean();
        latestOrder = await Order.findById(onlineResult.order_id).lean();
      }

      const linkedQuote = await Quote.findById(quote._id)
        .populate(QUOTE_MOBILE_DETAIL_POPULATE)
        .lean();
      await attachPartnerServiceToQuote(linkedQuote);

      const depositCollected =
        onlineResult.already_completed && paymentRow?.status === 'completed';

      return ok(onlineResult.status, {
        message: onlineResult.resumed
          ? 'Continue your pending payment to convert this quote to an order.'
          : onlineResult.already_completed
            ? 'Quote converted to order and payment completed successfully.'
            : 'Complete payment to convert quote to order.',
        data: {
          quote: formatMobileQuoteForApi(linkedQuote),
          ...(latestOrder ? { order: formatMobileOrderForApi(latestOrder) } : {}),
          payment: {
            ...paymentRow,
            payment_url: onlineResult.payment_url || null,
            resumed: Boolean(onlineResult.resumed),
          },
          deposit: buildQuoteDepositSummary(minimumDeposit, paidAmount, depositCollected),
        },
      });
    }

    let created;
    try {
      created = await createOrderFromQuote(quote, { actorUserId: customerId });
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

    const refreshedOrder = await Order.findById(created.order._id).lean();

    void safeNotifyQuoteStatusChanged({
      quote: await Quote.findById(quote._id).lean(),
      previousStatus: quoteStatusBeforeConvert,
      newStatus: 'success',
      actorUserId: customerId,
    });

    if (paymentStatus === 'completed') {
      void safeNotifyOrderPaymentReceived({
        order: refreshedOrder || created.order,
        payment: orderPayment.toObject(),
        actorUserId: customerId,
      });
    }

    const linkedQuote = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(linkedQuote);

    return ok(200, {
      message: 'Quote converted to order successfully.',
      data: {
        quote: formatMobileQuoteForApi(linkedQuote),
        order: formatMobileOrderForApi(created.order),
        payment: orderPayment.toObject(),
        deposit: buildQuoteDepositSummary(
          minimumDeposit,
          paidAmount,
          paymentStatus === 'completed'
        ),
      },
    });
  } catch (err) {
    console.error('mobile user convert quote', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getCustomerQuoteDepositPaymentStatus = async (customerId, quoteId, paymentId) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(quoteId))) {
      return fail(400, 'Invalid quote id.');
    }
    if (!mongoose.Types.ObjectId.isValid(String(paymentId))) {
      return fail(400, 'Invalid payment id.');
    }

    const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
    if (!quote) {
      return fail(404, 'Quote not found.');
    }

    const access = assertCustomerOwnsQuote(customerId, quote);
    if (!access.ok) return access;

    const payment = await OrderPayment.findOne({
      _id: paymentId,
      quote_id: quote._id,
      payer_type: 'customer',
      deleted_at: null,
    }).lean();

    if (!payment) {
      return fail(404, 'Quote deposit payment not found.');
    }

    let syncResult = null;
    if (
      payment.status === 'pending' &&
      payment.payment_method === GATEWAY_PAYMENT_METHOD &&
      payment.transaction_reference
    ) {
      syncResult = await syncPendingQuoteDepositPayment(payment._id);
    }

    let latestPayment = payment;
    if (syncResult?.synced) {
      latestPayment = await OrderPayment.findById(payment._id).lean();
    }

    let paymentUrl = null;
    if (latestPayment.status === 'pending' && latestPayment.transaction_reference) {
      try {
        const link = await fetchPaymentLink(latestPayment.transaction_reference);
        if (RAZORPAY_LINK_RESUMABLE.has(link.status) && link.short_url) {
          paymentUrl = link.short_url;
        }
      } catch (err) {
        console.error('getCustomerQuoteDepositPaymentStatus fetchPaymentLink', err?.response?.data || err.message);
      }
    }

    let gatewayPayment = null;
    if (latestPayment.status === 'completed') {
      gatewayPayment = await GatewayPayment.findOne({
        purpose: PAYMENT_PURPOSES.ORDER,
        reference_id: latestPayment._id,
        deleted_at: null,
      })
        .select(
          'amount currency status payment_method gateway_payment_link_id gateway_payment_id instrument_type paid_at created_at'
        )
        .lean();
    }

    let latestOrder = null;
    if (latestPayment.order_id) {
      latestOrder = await Order.findById(latestPayment.order_id).lean();
    }

    const linkedQuote = await Quote.findById(quote._id)
      .populate(QUOTE_MOBILE_DETAIL_POPULATE)
      .lean();
    await attachPartnerServiceToQuote(linkedQuote);

    const minimumDeposit = Number(quote.minimum_deposit_amount) || 0;
    const depositAmount = Number(latestPayment.amount) || 0;
    const depositCollected = latestPayment.status === 'completed';

    return ok(200, {
      message: syncResult?.synced
        ? syncResult.refunded
          ? 'Payment was received but the quote is no longer valid; deposit was refunded.'
          : 'Payment verified with Razorpay and quote converted to order.'
        : 'Quote deposit payment status fetched successfully.',
      data: {
        payment_id: latestPayment._id,
        quote_id: latestPayment.quote_id,
        order_id: latestPayment.order_id || null,
        status: latestPayment.status,
        amount: latestPayment.amount,
        payment_method: latestPayment.payment_method,
        transaction_reference: latestPayment.transaction_reference,
        payment_url: paymentUrl,
        paid_at: latestPayment.paid_at,
        gateway_payment: gatewayPayment,
        quote: formatMobileQuoteForApi(linkedQuote),
        ...(latestOrder ? { order: formatMobileOrderForApi(latestOrder) } : {}),
        deposit: buildQuoteDepositSummary(minimumDeposit, depositAmount, depositCollected),
        ...(syncResult
          ? {
              sync: {
                attempted: payment.status === 'pending',
                synced: syncResult.synced,
                refunded: Boolean(syncResult.refunded),
                reason: syncResult.reason || null,
                razorpay_status: syncResult.razorpay_status || null,
                message: syncResult.message || null,
              },
            }
          : {}),
      },
    });
  } catch (err) {
    console.error('mobile user get quote deposit payment status', err.message);
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
  getCustomerQuoteDepositPaymentStatus,
};

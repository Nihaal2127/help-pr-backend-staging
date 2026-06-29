const mongoose = require("mongoose");
const Order = require("../models/order");
const OrderService = require("../models/order_services");
const User = require("../models/user");
const Service = require("../models/service");
const Address = require("../models/address");
const Quote = require("../models/quote");
const { getOrderId } = require("../helper/id_generator");
const { recalculateOrderTotals } = require("../utils/order_financials");
const { OrderCreationError } = require("../errors/order_creation_error");
const {
  resolveOrderPricing,
  applyPricingToOrderDocument,
  mapPricingToServiceLineWithOffer,
} = require("./order_pricing_service");
const { createOrderOfferRecord } = require("./order_offer_service");
const {
  applyNestedResourcesOnCreate,
} = require("./order_nested_resources_service");
const { combineDateAndTime } = require("../utils/order_schedule");
const { normalizeAdminDescription } = require("../utils/admin_description_access");
const { resolveQuoteStatus } = require("../enum/quote_status_enum");
const {
  DEFAULT_ORDER_STATUS,
  buildOrderStatusInfo,
} = require("../enum/order_status_enum");
const {
  DEFAULT_PARTNER_WORK_STATUS,
  buildPartnerWorkStatusInfo,
} = require("../enum/partner_work_status_enum");
const { resolveOrderFranchiseIdForCreate } = require("../utils/order_access");
const { safeCreateDefaultAppointmentForOrder } = require("./appointment_service");
const { provisionOrderChatForOrder } = require("./chat_integration");
const {
  safeNotifyOrderCreated,
  safeNotifyOrderNestedResources,
} = require("../src/modules/notifications/services/domainHooks");

const ORDER_TYPE_DEFAULT = 2;

/**
 * Validates quote can be linked to a new order (same rules as POST /api/order/create).
 */
const resolveQuoteForOrderLink = async (quoteIdRaw) => {
  const qid = String(quoteIdRaw || "").trim();
  if (!qid) {
    return { ok: true, quoteObjectId: null, quoteDescription: "" };
  }
  if (!mongoose.Types.ObjectId.isValid(qid)) {
    return { ok: false, status: 400, message: "Invalid quote." };
  }

  const qDoc = await Quote.findOne({ _id: qid, deleted_at: null })
    .select("quote_description order_id status")
    .lean();
  if (!qDoc) {
    return { ok: false, status: 404, message: "Quote not found." };
  }
  if (qDoc.order_id != null) {
    return { ok: false, status: 409, message: "Quote is already linked to an order." };
  }
  if (resolveQuoteStatus(qDoc) !== "accepted") {
    return {
      ok: false,
      status: 409,
      message: "Only accepted quotes can be converted to an order.",
    };
  }

  const quoteObjectId = new mongoose.Types.ObjectId(qid);
  const existingOrderForQuote = await Order.findOne({
    quote_id: quoteObjectId,
    deleted_at: null,
  })
    .select("_id")
    .lean();
  if (existingOrderForQuote) {
    return {
      ok: false,
      status: 409,
      message: "Another order already references this quote.",
    };
  }

  return {
    ok: true,
    quoteObjectId,
    quoteDescription: (qDoc.quote_description || "").trim(),
  };
};

/**
 * Sets quote.order_id and quote.status = success after order is persisted.
 */
const linkQuoteToOrder = async (quoteId, orderId) => {
  const quote = await Quote.findOne({ _id: quoteId, deleted_at: null });
  if (!quote) {
    throw new OrderCreationError("Quote not found.", 404);
  }
  if (quote.order_id != null) {
    throw new OrderCreationError("Quote is already linked to an order.", 409);
  }
  if (resolveQuoteStatus(quote) !== "accepted") {
    throw new OrderCreationError(
      "Only accepted quotes can be converted to an order.",
      409
    );
  }

  quote.order_id = orderId;
  quote.status = "success";
  quote.updated_at = new Date();
  await quote.save();
  return quote;
};

/**
 * Shared order + order_service creation used by POST /api/order/create and POST /api/quote/convert/:id.
 */
const createOrderFromBody = async (body, options = {}) => {
  const {
    linkQuote = true,
    notifyPartners = true,
    order_id: presetOrderId = null,
    callerFranchiseId = null,
    callerType = null,
  } = options;

  const {
    user_id,
    user_unique_id,
    city_id,
    category_id,
    is_paid,
    payment_mode_id,
    transaction_id,
    created_by_id,
    service_items,
    order_date,
    sub_total,
    tax,
    discount_amount,
    user_paltform_fee,
    partner_commison_platform_fee,
    total_price,
    admin_earning,
    address,
    type,
    partner_id,
    employee_id,
    franchise_id,
    address_id,
    service_id,
    from_date,
    to_date,
    work_hours_per_day,
    total_work_hours,
    work_start_time,
    work_end_time,
    service_price,
    customer_description,
    rejection_reason,
    admin_commission,
    discount_percent,
    discount_code,
    discount_reason,
    min_deposit,
    payment_schedule_type,
    customer_payment_method,
    order_description,
    admin_description,
    quote_id,
    offer_id,
  } = body;

  const order_id =
    presetOrderId && mongoose.Types.ObjectId.isValid(presetOrderId)
      ? new mongoose.Types.ObjectId(presetOrderId)
      : new mongoose.Types.ObjectId();

  let resolvedQuoteId = null;
  let quoteDescriptionWhenLinked = "";
  if (linkQuote && quote_id !== undefined && quote_id !== null && String(quote_id).trim() !== "") {
    const quoteResult = await resolveQuoteForOrderLink(quote_id);
    if (!quoteResult.ok) {
      throw new OrderCreationError(quoteResult.message, quoteResult.status);
    }
    resolvedQuoteId = quoteResult.quoteObjectId;
    quoteDescriptionWhenLinked = quoteResult.quoteDescription;
  }

  const orderDescFromBody =
    order_description !== undefined && order_description !== null
      ? String(order_description).trim()
      : "";
  const finalOrderDescription = orderDescFromBody || quoteDescriptionWhenLinked;

  if (!Array.isArray(service_items) || service_items.length !== 1) {
    throw new OrderCreationError(
      "Each order must contain exactly one service; service_items must be an array of length 1."
    );
  }

  const single = service_items[0];
  const unique_id = await getOrderId();

  const resolvedPartnerId = partner_id ?? single.partner_id ?? null;
  const resolvedServiceId = service_id ?? single.service_id ?? null;

  let quoteFranchiseId = null;
  if (resolvedQuoteId) {
    const quoteFranchiseDoc = await Quote.findOne({ _id: resolvedQuoteId })
      .select("franchise_id")
      .lean();
    quoteFranchiseId = quoteFranchiseDoc?.franchise_id ?? null;
  }

  const resolvedFranchiseId = await resolveOrderFranchiseIdForCreate({
    franchiseIdFromBody: franchise_id,
    partnerId: resolvedPartnerId,
    createdById: created_by_id,
    quoteFranchiseId,
    callerFranchiseId,
    callerType,
  });

  const { pricing, pricingMeta, orderOfferSnapshot } = await resolveOrderPricing(
    body,
    single,
    resolvedServiceId
  );

  const linePricing = mapPricingToServiceLineWithOffer(pricing, orderOfferSnapshot, {
    partner_earning: single.partner_earning,
    admin_earning: admin_earning ?? pricing.commission_amount,
  });

  const orderItemsWithOrderId = await Promise.all(
    service_items.map(async (option) => {
      const user = await User.findById(new mongoose.Types.ObjectId(option.user_id));
      if (!user) {
        throw new Error("INVALID_SERVICE_USER");
      }
      const partner = option.partner_id
        ? await User.findById(new mongoose.Types.ObjectId(option.partner_id))
        : null;
      return {
        _id: new mongoose.Types.ObjectId(),
        ...option,
        ...linePricing,
        service_status: option.service_status ?? DEFAULT_ORDER_STATUS,
        order_id,
        order_unique_id: unique_id,
        user_unique_id: user.user_id,
        partner_unique_id: partner?.user_id || option.partner_unique_id || "",
        payment_mode_id,
        transaction_id,
      };
    })
  );

  const savedDataOptions = await OrderService.insertMany(orderItemsWithOrderId);
  const order_items = savedDataOptions.map((doc) => doc._id);

  const newOrder = new Order({
    _id: order_id,
    unique_id,
    user_id,
    user_unique_id,
    city_id,
    category_id,
    is_paid,
    payment_mode_id,
    transaction_id,
    created_by_id,
    service_items: order_items,
    order_status: DEFAULT_ORDER_STATUS,
    order_status_info: buildOrderStatusInfo(),
    partner_work_status: DEFAULT_PARTNER_WORK_STATUS,
    partner_work_status_info: buildPartnerWorkStatusInfo(),
    order_date,
    address,
    type,
    partner_id: resolvedPartnerId,
    employee_id: employee_id ?? null,
    franchise_id: resolvedFranchiseId,
    address_id: address_id ?? null,
    service_id: resolvedServiceId,
    from_date: from_date ? new Date(from_date) : null,
    to_date: to_date ? new Date(to_date) : null,
    work_hours_per_day:
      work_hours_per_day !== undefined ? Number(work_hours_per_day) : 0,
    total_work_hours:
      total_work_hours !== undefined ? Number(total_work_hours) : 0,
    work_start_time: work_start_time ?? "",
    work_end_time: work_end_time ?? "",
    customer_description: customer_description ?? "",
    order_description: finalOrderDescription,
    admin_description:
      admin_description !== undefined
        ? normalizeAdminDescription(admin_description)
        : null,
    quote_id: resolvedQuoteId,
    rejection_reason: rejection_reason ?? "",
    payment_schedule_type:
      payment_schedule_type === "installments" ? "installments" : "single",
    customer_payment_method: customer_payment_method ?? "",
    additional_charges_subtotal: 0,
    additional_charges_commission: 0,
    additional_charges_tax: 0,
    additional_charges_total: 0,
  });

  applyPricingToOrderDocument(newOrder, pricing, admin_earning, orderOfferSnapshot);

  return {
    newOrder,
    order_id,
    unique_id,
    service_items,
    resolvedQuoteId,
    pricingMeta,
    orderOfferSnapshot,
  };
};

const persistOrderAndLinkQuote = async (
  { newOrder, order_id, service_items, resolvedQuoteId, orderOfferSnapshot },
  { notifyPartners = true, requestBody = null, actorUserId = null } = {}
) => {
  await newOrder.save();

  if (orderOfferSnapshot) {
    const orderOfferDoc = await createOrderOfferRecord(order_id, orderOfferSnapshot);
    newOrder.order_offer_id = orderOfferDoc._id;
    newOrder.offer_id = orderOfferSnapshot.offer_id;
    await newOrder.save();
  }

  const nested = requestBody
    ? await applyNestedResourcesOnCreate(newOrder, requestBody)
    : null;

  await recalculateOrderTotals(order_id);

  if (resolvedQuoteId) {
    await linkQuoteToOrder(resolvedQuoteId, order_id);
  }

  const refreshed = await Order.findById(order_id);

  void safeCreateDefaultAppointmentForOrder(refreshed || newOrder, {
    actorUserId,
  });

  void provisionOrderChatForOrder(refreshed || newOrder);

  if (notifyPartners) {
    void safeNotifyOrderCreated({
      order: refreshed || newOrder,
      actorUserId,
      serviceItems: service_items,
    });
  }
  void safeNotifyOrderNestedResources({
    order: refreshed || newOrder,
    nested,
    actorUserId,
  });

  return { order: refreshed || newOrder, nested };
};

/**
 * Build POST /api/order/create body from an approved quote document.
 */
const buildCreateInputFromQuote = async (quote) => {
  const addressDoc = await Address.findById(quote.address_id);
  if (!addressDoc) {
    throw new OrderCreationError("Address not found for this quote.");
  }

  const customer = await User.findById(quote.user_id);
  const partner = await User.findById(quote.partner_id);
  if (!customer || !partner) {
    throw new OrderCreationError("Customer or partner user record missing.");
  }

  const service_from_time = combineDateAndTime(
    quote.from_date,
    quote.work_start_time
  );
  const service_to_time = combineDateAndTime(quote.from_date, quote.work_end_time);
  if (!service_from_time || !service_to_time) {
    throw new OrderCreationError(
      "Could not build service times from from date, work start time, and work end time."
    );
  }

  const charge =
    Number(quote.total_service_charge) || Number(quote.service_price) || 0;
  if (!(charge > 0)) {
    throw new OrderCreationError(
      "Quote must have total_service_charge (or service_price) greater than 0 before converting to an order.",
      409
    );
  }
  const addressStr =
    addressDoc.address ||
    [addressDoc.landmark, addressDoc.area].filter(Boolean).join(", ") ||
    "";
  const quoteDescription = (quote.quote_description || "").trim();

  const pricingFromQuote = {
    total_service_charge: charge,
    service_price: charge,
    commission_amount: Number(quote.commission_amount) || 0,
    tax_amount: Number(quote.tax_amount) || 0,
    sub_total: Number(quote.sub_total) || 0,
    total_price: Number(quote.total_price) || 0,
    minimum_deposit_amount: Number(quote.minimum_deposit_amount) || 0,
    discount_amount: null,
  };

  return {
    user_id: quote.user_id,
    user_unique_id: customer.user_id || "",
    city_id: addressDoc.city_id,
    category_id: quote.category_id,
    is_paid: false,
    payment_mode_id: "",
    transaction_id: "",
    created_by_id:
      quote.created_by_id != null ? quote.created_by_id : quote.user_id,
    order_date: quote.from_date,
    ...pricingFromQuote,
    address: addressStr,
    type: ORDER_TYPE_DEFAULT,
    partner_id: quote.partner_id,
    employee_id: quote.employee_id ?? null,
    franchise_id: quote.franchise_id ?? null,
    address_id: quote.address_id,
    service_id: quote.service_id,
    from_date: quote.from_date,
    to_date: quote.to_date,
    work_hours_per_day: quote.work_hours_per_day ?? 0,
    total_work_hours: quote.total_work_hours ?? 0,
    work_start_time: quote.work_start_time || "",
    work_end_time: quote.work_end_time || "",
    customer_description: quoteDescription,
    order_description: quoteDescription,
    quote_id: quote._id,
    rejection_reason: "",
    discount_percent: null,
    discount_code: "",
    discount_reason: "",
    payment_schedule_type: "single",
    customer_payment_method: "",
    service_items: [
      {
        user_id: quote.user_id,
        partner_id: quote.partner_id,
        category_id: quote.category_id,
        service_id: quote.service_id,
        service_date: quote.from_date,
        service_from_time,
        service_to_time,
        ...pricingFromQuote,
        is_paid: false,
        rating: 0,
      },
    ],
  };
};

/**
 * Creates order from quote using the same path as POST /api/order/create, then links quote.
 */
const createOrderFromQuote = async (quote, options = {}) => {
  const body = await buildCreateInputFromQuote(quote);
  const draft = await createOrderFromBody(body, {
    linkQuote: true,
    ...options,
  });
  const { order } = await persistOrderAndLinkQuote(draft, {
    notifyPartners: options.notifyPartners !== false,
    requestBody: body,
    actorUserId: options.actorUserId || null,
  });
  return { order, unique_id: draft.unique_id, order_id: draft.order_id };
};

module.exports = {
  OrderCreationError,
  ORDER_TYPE_DEFAULT,
  buildOrderStatusInfo,
  resolveQuoteForOrderLink,
  linkQuoteToOrder,
  createOrderFromBody,
  persistOrderAndLinkQuote,
  buildCreateInputFromQuote,
  createOrderFromQuote,
};

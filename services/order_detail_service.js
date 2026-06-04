const Order = require('../models/order');
const OrderAdditionalCharge = require('../models/order_additional_charge');
const OrderPayment = require('../models/order_payment');
const OrderOffer = require('../models/order_offer');
const { formatOrderForApi } = require('../utils/order_api_format');
const { attachRefundsToOrderRecords } = require('./refund_service');

const ORDER_DETAIL_POPULATE = [
  {
    path: 'user_id',
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: 'city_id', select: 'name' }],
  },
  { path: 'city_id', select: 'name city_service_price' },
  { path: 'category_id', select: 'name category_id desc image_url' },
  { path: 'created_by_id', select: 'name user_id email phone_number profile_url' },
  {
    path: 'partner_id',
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: 'city_id', select: 'name' }],
  },
  { path: 'employee_id', select: 'name user_id email phone_number profile_url' },
  { path: 'franchise_id', select: 'name city_name state_name' },
  { path: 'address_id' },
  { path: 'service_id', select: 'name service_id desc image_url' },
  {
    path: 'quote_id',
    select:
      'quote_sequence_id status quote_description service_price from_date to_date created_at',
  },
  {
    path: 'service_items',
    populate: [
      {
        path: 'partner_id',
        select: 'name user_id email phone_number profile_url city_id',
        populate: [{ path: 'city_id', select: 'name' }],
      },
      { path: 'service_id', select: 'name service_id desc image_url' },
    ],
  },
];

function shapeOrderDetailResponse(populatedOrderData, additional_charges, order_payments, order_offer) {
  return formatOrderForApi({
    ...populatedOrderData,
    created_by_id: populatedOrderData.created_by_id?._id ?? populatedOrderData.created_by_id,
    created_by_info: populatedOrderData.created_by_id,
    created_by_name: populatedOrderData.created_by_id?.name,

    user_id: populatedOrderData.user_id?._id ?? populatedOrderData.user_id,
    user_info: populatedOrderData.user_id
      ? {
          ...populatedOrderData.user_id,
          city_name: populatedOrderData.user_id.city_id?.name || null,
          city_id: populatedOrderData.user_id.city_id?._id || null,
        }
      : null,

    city_id: populatedOrderData.city_id?._id ?? populatedOrderData.city_id,
    city_info: populatedOrderData.city_id,

    category_id: populatedOrderData.category_id?._id ?? populatedOrderData.category_id,
    category_info: populatedOrderData.category_id,

    partner_id: populatedOrderData.partner_id?._id ?? populatedOrderData.partner_id,
    partner_info:
      populatedOrderData.partner_id && populatedOrderData.partner_id._id
        ? {
            ...populatedOrderData.partner_id,
            city_name: populatedOrderData.partner_id.city_id?.name || null,
            city_id: populatedOrderData.partner_id.city_id?._id || null,
          }
        : null,

    employee_id: populatedOrderData.employee_id?._id ?? populatedOrderData.employee_id,
    employee_info: populatedOrderData.employee_id?._id ? populatedOrderData.employee_id : null,

    franchise_id: populatedOrderData.franchise_id?._id ?? populatedOrderData.franchise_id,
    franchise_info: populatedOrderData.franchise_id?._id ? populatedOrderData.franchise_id : null,

    address_id: populatedOrderData.address_id?._id ?? populatedOrderData.address_id,
    address_info: populatedOrderData.address_id?._id ? populatedOrderData.address_id : null,

    service_id: populatedOrderData.service_id?._id ?? populatedOrderData.service_id,
    service_info: populatedOrderData.service_id?._id ? populatedOrderData.service_id : null,

    quote_id: populatedOrderData.quote_id?._id ?? populatedOrderData.quote_id,
    quote_info: populatedOrderData.quote_id?._id ? populatedOrderData.quote_id : null,

    service_items: (populatedOrderData.service_items || []).map((serviceItem) => {
      const hasValidPartner = serviceItem.partner_id && serviceItem.partner_id._id;

      return {
        ...serviceItem,
        ...(hasValidPartner && {
          partner_info: {
            ...serviceItem.partner_id,
            city_name: serviceItem.partner_id.city_id?.name || null,
            city_id: serviceItem.partner_id.city_id?._id || null,
          },
        }),
        service_info: serviceItem.service_id,
        partner_id: undefined,
        service_id: undefined,
      };
    }),

    additional_charges,
    order_payments,
    order_offer: order_offer || null,
  });
}

async function loadOrderDetailLean(orderMongoId, options = {}) {
  const populatedOrderData = await Order.findById(orderMongoId).populate(ORDER_DETAIL_POPULATE).lean();
  if (!populatedOrderData) return null;
  const [additional_charges, order_payments, order_offer] = await Promise.all([
    OrderAdditionalCharge.find({ order_id: orderMongoId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean(),
    OrderPayment.find({ order_id: orderMongoId, deleted_at: null }).sort({ created_at: -1 }).lean(),
    OrderOffer.findOne({ order_id: orderMongoId }).lean(),
  ]);
  const shaped = shapeOrderDetailResponse(
    populatedOrderData,
    additional_charges,
    order_payments,
    order_offer
  );
  const [withRefunds] = await attachRefundsToOrderRecords([shaped], options);
  return withRefunds;
}

module.exports = {
  ORDER_DETAIL_POPULATE,
  shapeOrderDetailResponse,
  loadOrderDetailLean,
};

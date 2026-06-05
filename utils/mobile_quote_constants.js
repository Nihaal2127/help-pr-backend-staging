const QUOTE_MOBILE_DETAIL_POPULATE = [
  { path: 'user_id', select: 'name user_id email phone_number profile_url type' },
  { path: 'partner_id', select: 'name user_id email phone_number profile_url type average_rating rating_count' },
  { path: 'employee_id', select: 'name user_id email phone_number profile_url type' },
  { path: 'created_by_id', select: 'name user_id email phone_number profile_url type' },
  {
    path: 'category_id',
    select:
      'name category_id desc image_url approval_status is_request is_active rejection_reason',
  },
  { path: 'service_id', select: 'name service_id desc image_url tax commission payment_type' },
  { path: 'franchise_id', select: 'name city_name state_name' },
  {
    path: 'address_id',
    select:
      'address landmark area area_id city_id state_id pincode contact_name contact_number',
    populate: [
      { path: 'city_id', select: 'name' },
      { path: 'state_id', select: 'name' },
      { path: 'area_id', select: 'name' },
    ],
  },
  { path: 'order_id', select: 'unique_id order_status total_price user_id' },
];

const CUSTOMER_QUOTE_FIELD_UPDATE_KEYS = [
  'partner_id',
  'category_id',
  'service_id',
  'address_id',
  'from_date',
  'to_date',
  'work_hours_per_day',
  'total_work_hours',
  'work_start_time',
  'work_end_time',
  'quote_description',
];

const DISALLOWED_CLIENT_PRICING_KEYS = [
  'commission_amount',
  'commission_percent',
  'tax_amount',
  'tax_percent',
  'sub_total',
  'total_price',
  'minimum_deposit_amount',
  'minimum_deposit_percent',
  'admin_commission',
  'discount_amount',
  'offer_id',
];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

module.exports = {
  QUOTE_MOBILE_DETAIL_POPULATE,
  CUSTOMER_QUOTE_FIELD_UPDATE_KEYS,
  DISALLOWED_CLIENT_PRICING_KEYS,
  TIME_REGEX,
};

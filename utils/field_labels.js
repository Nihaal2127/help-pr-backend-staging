/**
 * Maps API field keys to user-facing labels for validation/error messages.
 * Use fieldLabel() for dynamic paths (e.g. partner_services[0].category_id).
 */

const FIELD_LABELS = {
    user_id: 'User',
    partner_id: 'Partner',
    employee_id: 'Employee',
    admin_id: 'Admin',
    created_by_id: 'Created by',
    category_id: 'Category',
    service_id: 'Service',
    franchise_id: 'Franchise',
    order_id: 'Order ID',
    quote_id: 'Quote',
    address_id: 'Address',
    area_id: 'Area',
    state_id: 'State',
    city_id: 'City',
    offer_id: 'Offer',
    subscription_plan_id: 'Subscription plan',
    categories_order: 'Categories order',
    services_order: 'Services order',
    from_admin_commission: 'Admin portion',
    from_partner_wallet: 'Partner wallet portion',
    refund_amount: 'Refund amount',
    pay_now_amount: 'Payment amount',
    payment_method: 'Payment method',
    payer_type: 'Payer type',
    transaction_type: 'Transaction type',
    transaction_reference: 'Transaction reference',
    order_status: 'Order status',
    service_status: 'Service status',
    partner_payment_status: 'Partner payment status',
    wallet_status: 'Wallet status',
    verification_status: 'Verification status',
    is_verified: 'Verification status',
    sort_by: 'Sort field',
    sort_order: 'Sort order',
    plan_name: 'Plan name',
    duration_type: 'Duration type',
    total_service_charge: 'Total service charge',
    service_price: 'Service price',
    discount_amount: 'Discount amount',
    value: 'Value',
    admin_contribution: 'Admin contribution',
    partner_contribution: 'Partner contribution',
    commission_amount: 'Commission amount',
    commission_percent: 'Commission percent',
    tax_amount: 'Tax amount',
    tax_percent: 'Tax percent',
    sub_total: 'Subtotal',
    total_price: 'Total price',
    minimum_deposit_amount: 'Minimum deposit amount',
    minimum_deposit_percent: 'Minimum deposit percent',
    admin_commission: 'Admin commission',
    html_content: 'HTML content',
    rejection_reason: 'Rejection reason',
    cancellation_reason: 'Cancellation reason',
    quote_description: 'Quote description',
    admin_description: 'Admin description',
    order_description: 'Order description',
    accessible_screens: 'Accessible screens',
    partner_services: 'Partner services',
    partner_categories: 'Partner categories',
    service_items: 'Service items',
    service_ids: 'Services',
    category_ids: 'Categories',
    from_date: 'From date',
    to_date: 'To date',
    start_date: 'Start date',
    end_date: 'End date',
    started_at: 'Start date',
    expires_at: 'Expiry date',
    date: 'Refund date',
    refund_date: 'Refund date',
    pincode: 'Pincode',
    email: 'Email',
    page: 'Page',
    url: 'URL',
    services: 'Services',
    active_categories: 'Active categories',
    inactive_categories: 'Inactive categories',
    categories_list: 'Categories list',
    active_services: 'Active services',
    inactive_services: 'Inactive services',
    services_list: 'Services list',
    category_name: 'Category name',
    is_accept_request: 'Accept request status',
    work_hours_per_day: 'Work hours per day',
    total_work_hours: 'Total work hours',
    work_start_time: 'Work start time',
    work_end_time: 'Work end time',
    status: 'Status',
    name: 'Name',
    id: 'ID',
    _id: 'ID',
    amount: 'Amount',
    additional_charges: 'Additional charges',
    order_payments: 'Order payments',
    payment_schedule_type: 'Payment schedule type',
    service_date: 'Service date',
    service_from_time: 'Service from time',
    service_to_time: 'Service to time',
    start_time: 'Start time',
    end_time: 'End time',
    paid_at: 'Paid at',
    banner_image_url: 'Banner image URL',
    description: 'Description',
    title: 'Title',
    reason: 'Reason',
    limit: 'Limit',
    customer_payment_status: 'Customer payment status',
    user_payment_status: 'Customer payment status',
    payment_status: 'Payment status',
    partner_work_status: 'Partner work status',
    is_paid: 'Paid status',
    is_primary: 'Primary',
    is_active: 'Active status',
    recipient_user_id: 'Recipient user',
    entity_id: 'Entity',
    target_plan_id: 'Target plan',
    service_items_id: 'Service item',
    installment_index: 'Installment index',
    post_type: 'Post type',
    charge_type: 'Charge type',
    bank_account: 'Bank account',
    id_token: 'ID token',
    legacy_service_name: 'Legacy service name',
    keep_existing_images: 'Existing images',
    partner_documents: 'Partner documents',
    min_price: 'Minimum price',
    max_price: 'Maximum price',
    initial_message: 'Initial message',
    // camelCase route/query params
    orderId: 'Order ID',
    partnerId: 'Partner',
    appointmentId: 'Appointment ID',
    chargeId: 'Charge ID',
    paymentId: 'Payment ID',
    disputeId: 'Dispute ID',
    postId: 'Post ID',
    reportId: 'Report ID',
    create: 'Create',
    update: 'Update',
    delete: 'Delete',
};

const titleCase = (text) =>
    text.replace(/\b\w/g, (c) => c.toUpperCase());

/** Split snake_case / camelCase / PascalCase into spaced words for fallback labels. */
const humanizeKey = (key) =>
    titleCase(
        String(key)
            .replace(/_/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim()
    );

const labelSegment = (segment) => {
    const bracket = segment.match(/^(.+?)\[(\d+)\]$/);
    if (bracket) {
        const base = FIELD_LABELS[bracket[1]] || humanizeKey(bracket[1]);
        return `${base} [item ${Number(bracket[2]) + 1}]`;
    }
    if (FIELD_LABELS[segment]) return FIELD_LABELS[segment];
    return humanizeKey(segment);
};

/**
 * @param {string} key - Field key or dotted/indexed path
 * @returns {string} User-facing label
 */
const fieldLabel = (key) => {
    if (key === undefined || key === null || String(key).trim() === '') {
        return 'Field';
    }
    const k = String(key).trim();
    if (FIELD_LABELS[k]) return FIELD_LABELS[k];
    if (!k.includes('.') && !k.includes('[')) {
        return humanizeKey(k);
    }
    return k.split('.').map(labelSegment).join(' → ');
};

module.exports = {
    FIELD_LABELS,
    fieldLabel,
};

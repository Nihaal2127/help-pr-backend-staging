const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const Order = require('../models/order');
const User = require('../models/user');
const Service = require('../models/service');
const NotificationSettings = require('../models/notification_settings');
const OrderService = require('../models/order_services');
const { applyPagination } = require('../utils/pagination');
const { validationResult } = require('express-validator');
const { parseBoolean } = require('../utils/parser');
const { sendTemplateEmail } = require('../helper/mail');
const { getOrderId } = require('../helper/id_generator');
const { checkObjectIdExists } = require('../validator/id_validator');
const { getOrderStatusKey, getOrderStatus } = require('../enum/order_status_enum');
const { sendPushNotification } = require('../service/firebase/push_service');
const { generatePaymentLink } = require('./razorpay_controller');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const OrderAdditionalCharge = require('../models/order_additional_charge');
const OrderPayment = require('../models/order_payment');
const { computeOrderTotal, recalculateOrderTotals } = require('../utils/order_financials');

const ORDER_DETAIL_POPULATE = [
  {
    path: "user_id",
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: "city_id", select: 'name' }],
  },
  { path: "city_id", select: 'name city_service_price' },
  { path: "category_id", select: 'name category_id desc image_url' },
  { path: "created_by_id", select: 'name user_id email phone_number profile_url' },
  {
    path: "partner_id",
    select: 'name user_id email phone_number profile_url city_id',
    populate: [{ path: "city_id", select: 'name' }],
  },
  { path: "employee_id", select: 'name user_id email phone_number profile_url' },
  { path: "franchise_id", select: 'name city_name state_name' },
  { path: "address_id" },
  { path: "service_id", select: 'name service_id desc image_url' },
  {
    path: "service_items",
    populate: [
      {
        path: "partner_id",
        select: 'name user_id email phone_number profile_url city_id',
        populate: [{ path: "city_id", select: 'name' }],
      },
      { path: "service_id", select: 'name service_id desc image_url' },
    ],
  },
];

function shapeOrderDetailResponse(populatedOrderData, additional_charges, order_payments) {
  return {
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
  };
}

async function loadOrderDetailLean(orderMongoId) {
  const populatedOrderData = await Order.findById(orderMongoId).populate(ORDER_DETAIL_POPULATE).lean();
  if (!populatedOrderData) return null;
  const [additional_charges, order_payments] = await Promise.all([
    OrderAdditionalCharge.find({ order_id: orderMongoId, deleted_at: null })
      .sort({ created_at: -1 })
      .lean(),
    OrderPayment.find({ order_id: orderMongoId, deleted_at: null }).sort({ created_at: -1 }).lean(),
  ]);
  return shapeOrderDetailResponse(populatedOrderData, additional_charges, order_payments);
}

const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const order_status = req.query.order_status !== undefined ? parseInt(req.query.order_status) : null;
    const is_paid = req.query.is_paid !== undefined ? parseBoolean(req.query.is_paid) : null;
    // if (req.query.unique_id) {
    //   filter.unique_id = { $regex: new RegExp(req.query.unique_id, "i") }; // Case-insensitive match
    // }

    let regex;
    if (req.query.keyword) {
      const sanitizedKeyword = sanitizeInput(req.query.keyword);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
    }
    const filter = {
      deleted_at: null,
      ...(req.query.order_status && { order_status: order_status }),
      ...(req.query.is_paid !== undefined && req.query.is_paid !== '' && { is_paid: is_paid }),
      ...(req.query.keyword && {
        $or: [
          { user_unique_id: regex },
          { unique_id: regex },
        ]
      })
    };

    const sort = { created_at: req.query.sort !== undefined ? parseInt(req.query.sort) : -1 };

    const { data: orders, totalCount, totalPages, currentPage } = await applyPagination(
      Order,
      filter,
      page,
      limit,
      sort
    );

    const populateOptions = orders.map((order) => {
      return [
        { path: "city_id" },
        { path: "category_id" },
      ];
    });

    const populatedOrder = await Promise.all(
      orders.map((order, index) =>
        Order.populate(order, populateOptions[index])
      )
    );
    const processedOrders = populatedOrder.map(order => {
      const { ...rest } = order;
      const city = order.city_id;
      const cat = order.category_id;

      return {
        ...rest,
        city_id: city?._id ?? city,
        city_name: city?.name ?? '',
        category_id: cat?._id ?? cat,
        category_name: cat?.name ?? '',
      };
    })

    res.status(200).json({
      success: true,
      status: 200,
      message: "Order list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedOrders,
    });
  } catch (err) {

    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};

const getCustomerOrder = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const filter = {
      deleted_at: null,
    };
    const user_id = req.query.user_id;
    if (!user_id || user_id === undefined || user_id.trim() === '') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Please enter user id",
      });
    }
    const userResult = checkObjectIdExists(User, user_id, 'user');
    if (userResult.exists === false) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: userResult.message,
      });
    }
    filter.user_id = new mongoose.Types.ObjectId(user_id);
    const sort = { created_at: -1 };

    const { data: orders, totalCount, totalPages, currentPage } = await applyPagination(
      Order,
      filter,
      page,
      limit,
      sort
    );

    res.status(200).json({
      success: true,
      status: 200,
      message: "Order list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: orders,
    });
  } catch (err) {
    console.error("Error fetching orders list:", err);
    res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
      error: err.message,
    });
  }
};

const getCustomerOrderDetails = async (req, res) => {
  const { id } = req.params;

  try {
    let order;
    if (/^sos-/i.test(id)) {
      order = await Order.findOne({ unique_id: new RegExp(`^${id}$`, "i") });
    } else {
      order = await Order.findById(id);
    }
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order details fetched successfully',
      record,
    });
  } catch (error) {
    console.error('Error fetching Order details:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const create = async (req, res) => {
  try {
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
      name,
      email,
      contact,
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
    } = req.body;
    const order_id = new mongoose.Types.ObjectId();

    if (!Array.isArray(service_items) || service_items.length !== 1) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Each order must contain exactly one service; service_items must be an array of length 1.',
      });
    }

    const single = service_items[0];
    const unique_id = await getOrderId();
    const orderItemsWithOrderId = await Promise.all(service_items.map(async (option) => {
      const user = await User.findById(new mongoose.Types.ObjectId(option.user_id));
      if (!user) {
        throw new Error('INVALID_SERVICE_USER');
      }
      const item = {
        _id: new mongoose.Types.ObjectId(),
        ...option,
        order_id,
        order_unique_id: unique_id,
        user_unique_id: user.user_id,
        payment_mode_id,
        transaction_id
      };
      return item;
    }));
    const savedDataOptions = await OrderService.insertMany(orderItemsWithOrderId);
    const order_items = savedDataOptions.map((doc) => doc._id);

    const order_status_info = [
      {
        status: 1,
        updated_at: Date.now()
      },
      {
        status: 2,
        updated_at: null
      },
      {
        status: 3,
        updated_at: null
      },
      {
        status: 4,
        updated_at: null
      }
    ];

    const resolvedPartnerId = partner_id ?? single.partner_id ?? null;
    const resolvedServiceId = service_id ?? single.service_id ?? null;
    const resolvedServicePrice =
      service_price !== undefined && service_price !== null
        ? Number(service_price)
        : Number(single.service_price ?? single.sub_total ?? 0);

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
      order_status_info,
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
      partner_id: resolvedPartnerId,
      employee_id: employee_id ?? null,
      franchise_id: franchise_id ?? null,
      address_id: address_id ?? null,
      service_id: resolvedServiceId,
      from_date: from_date ? new Date(from_date) : null,
      to_date: to_date ? new Date(to_date) : null,
      work_hours_per_day: work_hours_per_day !== undefined ? Number(work_hours_per_day) : 0,
      total_work_hours: total_work_hours !== undefined ? Number(total_work_hours) : 0,
      work_start_time: work_start_time ?? '',
      work_end_time: work_end_time ?? '',
      service_price: resolvedServicePrice,
      customer_description: customer_description ?? '',
      rejection_reason: rejection_reason ?? '',
      admin_commission: admin_commission !== undefined ? Number(admin_commission) : 0,
      discount_percent: discount_percent !== undefined && discount_percent !== null ? Number(discount_percent) : null,
      discount_code: discount_code ?? '',
      discount_reason: discount_reason ?? '',
      min_deposit: min_deposit !== undefined ? Number(min_deposit) : 0,
      payment_schedule_type: payment_schedule_type === 'installments' ? 'installments' : 'single',
      customer_payment_method: customer_payment_method ?? '',
      additional_charges_total: 0,
    });

    newOrder.total_price = computeOrderTotal(newOrder, 0);

    if (newOrder.payment_mode_id === "2") {
      const responsePaymentLink = await generatePaymentLink(name, email, contact, newOrder.total_price);
      if (responsePaymentLink.success === true) {
        newOrder.transaction_id = responsePaymentLink.transaction_id;
        await newOrder.save();
        await recalculateOrderTotals(order_id);
        await Promise.all(
          service_items.map(async (service) => {
            try {
              const partner = await User.findById(new mongoose.Types.ObjectId(service.partner_id));
              if (!partner) return;

              const notificationSetting = await NotificationSettings.findOne({ user_id: partner._id });
              if (!notificationSetting) return;
              if (notificationSetting.is_update_allow === false) return;

              const serviceData = await Service.findById(service.service_id);
              const title = `New Service Request Received`;
              const body = `You received request for ${serviceData.name} for order #${unique_id}`;
              const deviceToken = partner.device_token
              const data = {
                order_id: order_id.toString(),
                type: "Order"
              };

              if (deviceToken !== null && deviceToken !== '') {
                await sendPushNotification({ deviceToken, title, body, data });
              }

              if (notificationSetting.is_sms_allow) {
                // Add SMS logic here
              }

            } catch (err) {
              console.error(`Error notifying partner ${service.partner_id}:`, err);
            }
          })
        );
        const result = {
          payment_url: responsePaymentLink.payment_url,
          order_id: newOrder._id
        }
        return res.status(200).json({
          success: true,
          status: 200,
          message: 'Order placed successfully and payment link send to customer.',
          record: result,
        });
      }
      return res.status(502).json({
        success: false,
        status: 502,
        message: responsePaymentLink.error || 'Failed to create payment link.',
      });

    } else {
      await newOrder.save();
      await recalculateOrderTotals(order_id);
      await Promise.all(
        service_items.map(async (service) => {
          try {
            const partner = await User.findById(new mongoose.Types.ObjectId(service.partner_id));
            if (!partner) return;

            const notificationSetting = await NotificationSettings.findOne({ user_id: partner._id });
            if (!notificationSetting) return;
            if (notificationSetting.is_update_allow === false) return;

            const serviceData = await Service.findById(service.service_id);
            const title = `New Service Request Received`;
            const body = `You received request for ${serviceData.name} for order #${unique_id}`;
            const deviceToken = partner.device_token
            const data = {
              order_id: order_id.toString(),
              type: "Order"
            };

            if (deviceToken !== null && deviceToken !== '') {
              await sendPushNotification({ deviceToken, title, body, data });
            }

            if (notificationSetting.is_sms_allow) {
              // Add SMS logic here
            }

          } catch (err) {
            console.error(`Error notifying partner ${service.partner_id}:`, err);
          }
        })
      );

      const result = {
        order_id: newOrder._id
      }
      return res.status(200).json({
        success: true,
        status: 200,
        message: 'Order placed successfully.',
        record: result,
      });
    }

  } catch (error) {
    if (error.message === 'INVALID_SERVICE_USER') {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Invalid user_id on service_items.',
      });
    }
    console.error('Error creating Order:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const update = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;


  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }
    const { order_status, is_paid } = req.body;

    const updateData = {};

    if (order_status !== undefined && order_status > order.order_status) {
      order.order_status_info[order_status - 1].updated_at = Date.now();
      order.order_status = order_status;
      updateData.service_status = order_status;
    }

    if (is_paid !== undefined) {
      order.is_paid = is_paid;
      updateData.is_paid = is_paid;
    }

    if (Object.keys(updateData).length > 0) {
      const updateCondition = {
        _id: { $in: order.service_items },
        service_status: { $ne: 4 }
      };

      await OrderService.updateMany(
        updateCondition,
        { $set: updateData }
      );
    }

    const updatedOrder = await order.save();


    const notificationSetting = await NotificationSettings.findOne({ user_id: order.user_id });
    if (notificationSetting?.is_update_allow) {
      const user = await User.findById(order.user_id);
      const deviceToken = user?.device_token
      const title = `Order Status Update`
      const body = `Your Order #${order.unique_id} status changed to ${getOrderStatus(order.order_status)}`
      const data = {
        order_id: order.id,
        order_status: `${order.order_status}`,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSetting?.is_sms_allow) {
      // Put logic for sent sms update
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order updated successfully',
      record: updatedOrder,
    });
  }
  catch (error) {
    console.error('Error updating Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const serviceUpdate = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const updateData = req.body;

  try {
    const service = await OrderService.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Order Service  not found'
      });
    }

    const originalPartnerId = service.partner_id?.toString();
    const originalServiceDate = service.service_date;
    const originalFromTime = service.service_from_time;
    const originalToTime = service.service_to_time;

    Object.keys(updateData).forEach((key) => {
      if (key === 'partner_id' ||
        key === 'service_date' ||
        key === 'service_from_time' ||
        key === 'service_to_time' ||
        key === 'service_status' ||
        key === 'is_paid'
      ) {
        service[key] = updateData[key];
      }
    });
    const partner = await User.findById(new mongoose.Types.ObjectId(service.partner_id));
    if (!partner) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Partner user not found for this service.',
      });
    }
    service.partner_unique_id = partner.user_id;
    const updatedService = await service.save();



    if (originalPartnerId && originalPartnerId !== service.partner_id?.toString()) {
      const oldPartner = await User.findById(originalPartnerId);
      const newPartner = await User.findById(service.partner_id);
      const serviceData = await Service.findById(service.service_id);

      // Notify old partner about cancellation
      const oldDeviceToken = oldPartner.device_token;
      if (oldDeviceToken !== null && oldDeviceToken !== '') {
        const title = "Service Cancelled";
        const body = `Service for order #${service.order_unique_id} has been cancelled from your list.`;
        const data = { order_id: service.order_id.toString(), type: "Order" };
        await sendPushNotification({
          deviceToken: oldDeviceToken,
          title,
          body,
          data
        });
      }

      // Notify new partner about new assignment
      const newDeviceToken = newPartner.device_token;
      if (newDeviceToken !== null && newDeviceToken !== '') {
        const title = "New Service Assigned";
        const body = `You have a new service (${serviceData.name}) for order #${service.order_unique_id}.`;
        const data = { order_id: service.order_id.toString(), type: "Order" };
        await sendPushNotification({
          newDeviceToken,
          title,
          body,
          data,
        });
      }
    }else if (
      originalServiceDate !== service.service_date ||
      originalFromTime !== service.service_from_time ||
      originalToTime !== service.service_to_time
    ) {
      const partner = await User.findById(service.partner_id);
      const deviceToken = partner.device_token;
      const serviceData = await Service.findById(service.service_id);

      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({
          deviceToken,
          title: "Service Time Updated",
          body: `Time updated for service (${serviceData.name}) of order #${service.order_unique_id}`,
          data: { order_id: service.order_id.toString(), type: "Order" }
        });
      }
    }else if (partner && service.service_status === 1) {
      const partnerNotifySettings = await NotificationSettings.findOne({ user_id: service.partner_id });
      if (partnerNotifySettings?.is_update_allow) {
        const serviceData = await Service.findById(service.service_id);
        const deviceToken = partner.device_token
        const title = `New Service Request Received`
        const body = `You received request for ${serviceData.name} for order #${service.order_unique_id}`
        const data = {
          order_id: service.order_id.toString(),
          type: "Order"
        }
        if (deviceToken !== null && deviceToken !== '') {
          await sendPushNotification({ deviceToken, title, body, data });
        }
      }
      if (partnerNotifySettings?.is_sms_allow) {
        // Put logic for sent sms update
      }
    }
    const userNotifySettings = await NotificationSettings.findOne({ user_id: service.user_id });
    if (userNotifySettings?.is_update_allow) {
      const user = await User.findById(service.user_id);
      const serviceData = await Service.findById(service.service_id);
      const deviceToken = user?.device_token
      const title = `Service Update`
      const body = `Your ${serviceData.name} status changed to ${getOrderStatus(service.service_status)} for order #${service.order_unique_id}`
      const data = {
        order_id: service.order_id.toString(),
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (userNotifySettings?.is_sms_allow) {
      // Put logic for sent sms update
    }

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order Service updated successfully',
      record: updatedService,
    });
  } catch (error) {
    console.error('Error updating Order Service:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const cancleService = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;

  if (req.body.service_items_id === undefined || req.body.service_items_id.trim() === '') {
    return res.status(409).json({
      success: false,
      status: 409,
      message: 'Service id require'
    });
  }
  const service_items_id = new mongoose.Types.ObjectId(req.body.service_items_id);



  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }
    let body;
    let partner;
    if (!order.service_items.some((sid) => sid.equals(service_items_id))) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Service id not found'
      });
    }

    const serviceData = await OrderService.findById(service_items_id);
    if (!serviceData) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Service line not found'
      });
    }

    partner = await User.findById(serviceData.partner_id);
    order.sub_total -= serviceData.sub_total;
    order.tax -= serviceData.tax;
    order.user_paltform_fee -= serviceData.user_paltform_fee;
    order.partner_commison_platform_fee -= serviceData.partner_commison_platform_fee;
    order.total_price -= serviceData.total_price;
    order.admin_earning -= serviceData.admin_earning;
    await OrderService.findByIdAndUpdate(service_items_id,
      { service_status: getOrderStatusKey('Cancelled') },
      { new: true, runValidators: true }
    );

    const serviceInfo = serviceData.service_id
      ? await Service.findById(serviceData.service_id)
      : null;
    body = serviceInfo
      ? `Your ${serviceInfo.name} for order #${order.unique_id} has been cancelled`
      : `A service for order #${order.unique_id} has been cancelled`;
    const updatedOrder = await order.save();
    await recalculateOrderTotals(order._id);

    if (partner) {
      const notificationSetting = await NotificationSettings.findOne({ user_id: partner._id });
      if (notificationSetting?.is_update_allow) {
        const deviceToken = partner.device_token
        const title = `Service cancel`
        const data = {
          order_id: order.id,
          type: "Order"
        }
        if (deviceToken !== null && deviceToken !== '') {
          await sendPushNotification({ deviceToken, title, body, data });
        }
      }
      if (notificationSetting?.is_sms_allow) {
        // Put logic for sent sms update
      }
    }

    const notificationSettingUser = await NotificationSettings.findOne({ user_id: order.user_id });
    if (notificationSettingUser?.is_update_allow) {
      const user = await User.findById(order.user_id);
      const deviceToken = user?.device_token
      const title = `Service cancel`
      const data = {
        order_id: order.id,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSettingUser?.is_sms_allow) {
      // Put logic for sent sms update
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order updated successfully',
      record: updatedOrder,
    });
  }
  catch (error) {
    console.error('Error updating Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const cancleOrder = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const { cancellation_reasone } = req.body;
  console.log('cancellation_reason is', cancellation_reasone);
  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }
    const CANCELLED_STATUS = getOrderStatusKey('Cancelled');
    order.order_status = CANCELLED_STATUS;
    order.cancellation_reasone = cancellation_reasone || '';
    order.order_status_info[3].updated_at = new Date();
    const updatedOrder = await order.save();

    await OrderService.updateMany(
      { _id: { $in: order.service_items } },
      {
        $set: {
          service_status: CANCELLED_STATUS,
          cancellation_reasone: cancellation_reasone || ''
        }
      }
    );

    const orderServices = await OrderService.find({
      _id: { $in: order.service_items }
    }).select("partner_id");
    console.log(orderServices);
    const notificationPromises = orderServices.map(async (service) => {
      const partnerId = service.partner_id;
      console.log(partnerId);
      if (!partnerId) return;

      // Fetch notification setting first
      const setting = await NotificationSettings.findOne({ user_id: partnerId });
      console.log(setting);
      if (!setting?.is_update_allow) return;

      // Fetch partner user and device token
      const partner = await User.findById(partnerId).select("device_token");
      console.log(partner);
      const deviceToken = partner?.device_token;
      console.log(deviceToken);
      if (deviceToken !== null && deviceToken !== '') {
        const title = "Order Cancelled";
        const body = `An order #${order.unique_id} related to your service has been cancelled`;
        const data = {
          order_id: order.id,
          type: "Order"
        };

        return sendPushNotification({
          deviceToken,
          title,
          body,
          data,
        });
      }
    });

    await Promise.all(notificationPromises.filter(Boolean));
    console.log('Notification sent.......');

    const notificationSetting = await NotificationSettings.findOne({ user_id: order.user_id });
    if (notificationSetting?.is_update_allow) {
      const user = await User.findById(order.user_id);
      const deviceToken = user?.device_token
      const title = `Order cancel`
      const body = `Your Order #${order.unique_id} has been cancelled`
      const data = {
        order_id: order.id,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({ deviceToken, title, body, data });
      }
    }
    if (notificationSetting?.is_sms_allow) {
      // Put logic for sent sms update
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Order cancelled successfully',
      record: updatedOrder,
    });
  }
  catch (error) {
    console.error('Error cancelled Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const getById = async (req, res) => {
  const { id } = req.params;

  try {
    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    const record = await loadOrderDetailLean(order._id);
    if (!record) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }

    res.status(200).json({
      success: true,
      status: 201,
      message: 'Order fetched successfully',
      record,
    });

  } catch (error) {
    console.error('Error fetching Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const deleteOrder = async (req, res) => {
  const { id } = req.params;

  try {

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'No record found'
      });
    }


    if (order.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Order is already deleted'
      });
    }


    order.deleted_at = new Date();


    await order.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Order deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Order:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const sendInvoiceEmail = async (req, res) => {
  const {
    email,
    html_content,
  } = req.body;

  const file = req.file;
  console.log(file);
  try {

    if (!file) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'No images uploaded.'
      });
    }
    const attachments = [
      {
        filename: 'invoice.pdf',
        path: file.path,
      },
    ]
    await sendTemplateEmail(email, 'SOS Order Invoice', html_content, 'Please find your invoice attached.', attachments);
    // await sendTemplateEmail('ishu624746@gmail.com','SOS Order Invoice',html_content,'Please find your invoice attached.',attachments);

    if (file && file.path) {
      fs.unlinkSync(file.path);
    } else {
      console.error("File path is undefined");
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Invoice sent successfully!',
    });
  } catch (error) {
    console.error('Error Sending Mail:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

module.exports = { getAll, create, update, getById, cancleOrder, deleteOrder, sendInvoiceEmail, getCustomerOrder, getCustomerOrderDetails, cancleService, serviceUpdate };
const mongoose = require("mongoose");
const OrderServices = require('../models/order_services');
const Order = require('../models/order');
const User = require('../models/user');
const { validationResult } = require('express-validator');
const { applyPagination } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { checkObjectIdExists } = require('../validator/id_validator');
const { normalizeOrderStatus } = require('../enum/order_status_enum');
const { fieldLabel } = require('../utils/field_labels');
const { roundMoney } = require('../utils/order_pricing');
const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const serviceStatusRaw =
      req.query.service_status !== undefined && req.query.service_status !== null
        ? String(req.query.service_status).trim()
        : '';
    const service_status = serviceStatusRaw ? normalizeOrderStatus(serviceStatusRaw) : null;
    if (serviceStatusRaw && !service_status) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: `Invalid ${fieldLabel('service_status')}. Use: in-progress, completed, cancelled, refunded.`,
      });
    }
    const is_paid = req.query.is_paid !== undefined ? parseBoolean(req.query.is_paid) : null;

    const filter = {
      deleted_at: null,
      ...(service_status && { service_status }),
      ...(req.query.is_paid !== undefined && req.query.is_paid !== '' && { is_paid: is_paid }),
    };

    if (req.query.unique_id) {
      filter.order_unique_id = { $regex: new RegExp(req.query.unique_id, "i") }; // Case-insensitive match
    }

    let regex;
    if (req.query.keyword) {
      const sanitizedKeyword = sanitizeInput(req.query.keyword);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
    }
    Object.assign(filter, {
      ...(req.query.keyword && {
        $or: [
          { name: regex },
          { order_unique_id: regex },
          { user_unique_id: regex },
          { partner_unique_id: regex },
        ]
      })
    });

    if (req.query.user_id) {

      const userResult = checkObjectIdExists(User, req.query.user_id, 'user');
      if (userResult.exists === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: userResult.message,
        });
      }
      filter.user_id = new mongoose.Types.ObjectId(req.query.user_id);
    }

    if (req.query.partner_id) {

      const userResult = checkObjectIdExists(User, req.query.partner_id, 'partner');
      if (userResult.exists === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: userResult.message,
        });
      }
      filter.partner_id = new mongoose.Types.ObjectId(req.query.partner_id);
    }

    const sort = { created_at: req.query.sort !== undefined ? parseInt(req.query.sort) : -1 };

    const { data: order_services, totalCount, totalPages, currentPage } = await applyPagination(
      OrderServices,
      filter,
      page,
      limit,
      sort
    );

    const populateOptions = order_services.map(() => {
      return [
        { path: "service_id" },
        { path: "category_id" },
      ];
    });

    const populatedOrderServices = await Promise.all(
      order_services.map((order_service, index) =>
        OrderServices.populate(order_service, populateOptions[index])
      )
    );

    const orderIds = [
      ...new Set(
        populatedOrderServices
          .map((row) => row.order_id)
          .filter(Boolean)
          .map((id) => String(id))
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    const orderPaymentById = new Map();
    if (orderIds.length > 0) {
      const orders = await Order.find({
        _id: { $in: orderIds },
        deleted_at: null,
      })
        .select(
          'user_payment_status payment_status is_paid customer_net_paid customer_due_amount'
        )
        .lean();

      for (const order of orders) {
        orderPaymentById.set(String(order._id), order);
      }
    }

    const processedOrderServices = populatedOrderServices.map(order_service => {
      const { ...rest } = order_service;
      const order = order_service.order_id
        ? orderPaymentById.get(String(order_service.order_id))
        : null;

      return {
        ...rest,

        service_id: order_service.service_id._id,
        service_unique_id: order_service.service_id.service_id,
        service_name: order_service.service_id.name,
        category_id: order_service.category_id._id,
        category_name: order_service.category_id.name,
        is_paid: order ? Boolean(order.is_paid) : Boolean(rest.is_paid),
        payment_status: order?.user_payment_status || order?.payment_status || 'unpaid',
        paid_amount: roundMoney(order?.customer_net_paid ?? 0),
        pending_amount: roundMoney(order?.customer_due_amount ?? 0),
      };
    })

    res.status(200).json({
      success: true,
      status: 200,
      message: "Order service list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: processedOrderServices,
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

const create = async (req, res) => {
  try {
    const {
      partner_id,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      is_primary,
      branch_name,
    } = req.body;
    const existingAccount = await PartnerBankAccount.findOne({
      account_number,
      deleted_at: null
    });
    if (existingAccount) {
      return res.status(409).json({
        success: false,
        status: 409,
        message: 'Account already exists.',
      });
    }
    const newAccount = new PartnerBankAccount({
      partner_id,
      bank_name,
      account_holder_name,
      account_number,
      ifsc_code,
      is_primary,
      branch_name,
    });
    const savedAccount = await newAccount.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account created successfully.',
      record: savedAccount,
    });
  } catch (error) {
    console.error('Error creating PartnerBankAccount:', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const getById = async (req, res) => {
  const { id } = req.params;

  try {
    const orderService = await OrderServices.findById(id).populate([
      {
        path: "order_id",
        select: 'address _id'
      },
      {
        path: "service_id",
        select: 'name _id'
      }
    ]).lean();

    if (!orderService) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Service not found'
      });
    }
    const response = {
      ...orderService,
      address: orderService.order_id.address,
      order_id: orderService.order_id._id,
      service_id: orderService.service_id._id,
      service_name: orderService.service_id.name,
    };

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Service fetched successfully',
      record: response,
    });
  } catch (error) {
    console.error('Error fetching Service:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const deleteAccount = async (req, res) => {
  const { id } = req.params;

  try {
    const partnerBankAccount = await PartnerBankAccount.findById(id);

    if (!partnerBankAccount) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Bank account not found'
      });
    }

    if (partnerBankAccount.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Bank account is already deleted'
      });
    }

    partnerBankAccount.deleted_at = new Date();

    await partnerBankAccount.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Bank account deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting PartnerBankAccount:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

/** Latest scheduled service date from order_service lines (fallback: order.order_date). */
const getLastServiceDate = async (user_id, userType) => {
  try {
    const baseFilter = { deleted_at: null };
    const lineFilter =
      userType === 2
        ? { ...baseFilter, partner_id: user_id }
        : { ...baseFilter, user_id };

    const lastLine = await OrderServices.findOne(lineFilter)
      .sort({ service_date: -1 })
      .select('service_date')
      .lean();
    if (lastLine?.service_date) {
      return lastLine.service_date;
    }

    const orderFilter =
      userType === 2
        ? { ...baseFilter, partner_id: user_id }
        : { ...baseFilter, user_id };
    const lastOrder = await Order.findOne(orderFilter)
      .sort({ order_date: -1 })
      .select('order_date')
      .lean();
    return lastOrder?.order_date ?? null;
  } catch (err) {
    return null;
  }
};

module.exports = { getAll, create, getById, deleteAccount, getLastServiceDate };

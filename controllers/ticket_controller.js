const mongoose = require("mongoose");
const Ticket = require('../models/ticket');
const User = require('../models/user');
const NotificationSettings = require('../models/notification_settings');
const { validationResult } = require('express-validator');

const { applyPagination, } = require('../utils/pagination');
const { parseBoolean } = require('../utils/parser');

const { getTicketId } = require('../helper/id_generator');
const { sanitizeInput } = require('../validator/search_keyword_validator');
const { checkObjectIdExists } = require('../validator/id_validator');
const { sendPushNotification } = require('../service/firebase/push_service');
const getAll = async (req, res) => {

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const type = parseInt(req.query.type);

    const is_active = req.query.is_active !== undefined ? parseBoolean(req.query.is_active) : null;

    let regex;
    if (req.query.keyword) {
      const sanitizedKeyword = sanitizeInput(req.query.keyword);
      regex = new RegExp(sanitizedKeyword, 'i'); // Case-insensitive regex search
    }
    const filter = {
      deleted_at: null,
      ...(req.query.type && { type: type }),
      ...(req.query.is_active && { is_active: is_active }),
      ...(req.query.keyword && {
        $or: [
          { created_by_name: regex },
          { user_unique_id: regex },
          { unique_id: regex },
          { query: regex },
          { resolved_by_name: regex },
        ]
      })
    };

    if (req.query.user_id) {
      const checkForUser = await checkObjectIdExists(User, req.query.user_id, 'user');
      if (checkForUser.exists === false) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: checkForUser.message,
        });
      }
      filter.created_by_id = new mongoose.Types.ObjectId(req.query.user_id);
    }
    const sort = { created_at: req.query.sort !== undefined ? parseInt(req.query.sort) : -1 };

    const projection = { password: 0, auth_token: 0 };
    const { data: tickets, totalCount, totalPages, currentPage } = await applyPagination(
      Ticket,
      filter,
      page,
      limit,
      sort,
      projection,
    );
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Ticket list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: tickets,
    });
  } catch (err) {
    console.log("Error is ", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const create = async (req, res) => {
  try {
    const {
      created_by_id,
      user_unique_id,
      status,
      resolve_status,
      created_by_name,
      email,
      phone_number,
      query,
      contact_type,
    } = req.body;


    const unique_id = await getTicketId();
    const newTicket = new Ticket({
      unique_id,
      created_by_id,
      user_unique_id,
      status,
      resolve_status,
      created_by_name,
      email,
      phone_number,
      query,
      contact_type,
    });
    const savedTicket = await newTicket.save();
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Ticket created successfully.',
      record: savedTicket,
    });
  } catch (error) {
    console.error('Error creating Ticket:', error.message);
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
  const updateData = req.body;

  try {
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Ticket not found'
      });
    }


    Object.keys(updateData).forEach((key) => {
      ticket[key] = updateData[key];
    });

    const updatedTicket = await ticket.save();
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Ticket updated successfully',
      record: updatedTicket,
    });
  } catch (error) {
    console.error('Error updating Ticket:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};

const updateTicketStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      status: 400,
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const {
    resolve_by_id,
    status,
    resolve_status,
    description
  } = req.body;

  try {

    let user = await User.findOne({ _id: resolve_by_id, deleted_at: null });
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Ticket not found'
      });
    }

    ticket.status = status;
    ticket.resolve_by_id = resolve_by_id;
    ticket.resolver_unique_id = user.user_id;
    ticket.resolve_status = resolve_status;
    ticket.resolved_by_name = user.name;
    ticket.description = description;
    if (status === 2) {
      ticket.close_date = Date.now();
    }


    const updatedTicket = await ticket.save();
    const notificationSetting = await NotificationSettings.findOne({ user_id: ticket.created_by_id });
    if (notificationSetting.is_update_allow) {
      const user = await User.findById(ticket.created_by_id);
      const deviceToken = user.device_token
      const title = `Ticket Update`
      const body = `Your ticket ${ticket.unique_id} status changed to ${status === 2 ? 'Close' : 'Open'}`
      const data = {
        order_id: service.order_id,
        type: "Order"
      }
      if (deviceToken !== null && deviceToken !== '') {
        await sendPushNotification({deviceToken, title, body, data});
      }
    }
    if (notificationSetting.is_sms_allow) {
      // Put logic for sent sms update
    }
    res.status(200).json({
      success: true,
      status: 200,
      message: 'Ticket updated successfully',
      record: updatedTicket,
    });
  } catch (error) {
    console.error('Error updating Ticket:', error);
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

    let ticket = await Ticket.findById({ _id: id }).lean();

    if (!ticket) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Ticket not found'
      });
    }


    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Ticket fetched successfully',
      record: ticket,
    });
  } catch (error) {
    console.error('Error fetching Ticket:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};
const deleteTicket = async (req, res) => {
  const { id } = req.params;

  try {
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Ticket not found'
      });
    }

    if (ticket.deleted_at) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Ticket is already deleted'
      });
    }

    ticket.deleted_at = new Date();

    await ticket.save();

    res.status(200).json({
      success: true,
      status: 200,
      message: 'Ticket deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Ticket:', error);
    res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.'
    });
  }
};


module.exports = { getAll, create, update, updateTicketStatus, getById, deleteTicket, };

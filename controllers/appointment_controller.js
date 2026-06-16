const Appointment = require("../models/appointment");
const { applyPagination } = require("../utils/pagination");
const { buildFieldDateRangeFilter } = require("../utils/schedule_date_filters");
const { sanitizeInput } = require("../validator/search_keyword_validator");
const { formatAppointmentForApi } = require("../utils/appointment_api_format");
const {
  resolveAppointmentListScope,
  assertAppointmentRecordAccess,
  assertOrderRecordAccess,
} = require("../utils/appointment_access");
const {
  createAppointmentForOrder,
  updateAppointmentById,
  softDeleteAppointmentById,
  resolveOrderByIdParam,
  resolveAppointmentByIdParam,
} = require("../services/appointment_service");
const { normalizeAppointmentStatus } = require("../enum/appointment_status_enum");

const create = async (req, res) => {
  try {
    const result = await createAppointmentForOrder(req, req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointment created successfully.",
      record: formatAppointmentForApi(result.record),
    });
  } catch (err) {
    console.error("appointment create:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const getAll = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;

    const scope = await resolveAppointmentListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scope.ok) {
      return res.status(scope.status).json({
        success: false,
        status: scope.status,
        message: scope.message,
      });
    }

    if (scope.noFranchise) {
      return res.status(200).json({
        success: true,
        status: 200,
        message: "Appointment list fetched successfully.",
        totalItems: 0,
        totalPages: 0,
        currentPage: page,
        records: [],
      });
    }

    const dateFilterResult = buildFieldDateRangeFilter(req.query, "service_date");
    if (!dateFilterResult.ok) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: dateFilterResult.message,
      });
    }

    const filter = {
      deleted_at: null,
      ...scope.filter,
      ...dateFilterResult.filter,
    };

    if (req.query.order_id) {
      const order = await resolveOrderByIdParam(req.query.order_id);
      if (!order) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid order_id filter.",
        });
      }
      const orderAccess = await assertOrderRecordAccess(req, order);
      if (!orderAccess.ok) {
        return res.status(orderAccess.status).json({
          success: false,
          status: orderAccess.status,
          message: orderAccess.message,
        });
      }
      filter.order_id = order._id;
    }

    if (req.query.status) {
      const normalized = normalizeAppointmentStatus(req.query.status);
      if (!normalized) {
        return res.status(400).json({
          success: false,
          status: 400,
          message: "Invalid status filter.",
        });
      }
      filter.status = normalized;
    }

    if (req.query.keyword) {
      const regex = new RegExp(sanitizeInput(req.query.keyword), "i");
      filter.$or = [
        { title: regex },
        { order_unique_id: regex },
        { partner_name: regex },
        { service_name: regex },
        { unique_id: regex },
      ];
    }

    const sort = {
      service_date: req.query.sort !== undefined ? parseInt(req.query.sort, 10) : -1,
      start_time: -1,
    };

    const { data, totalCount, totalPages, currentPage } = await applyPagination(
      Appointment,
      filter,
      page,
      limit,
      sort
    );

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointment list fetched successfully.",
      totalItems: totalCount,
      totalPages,
      currentPage,
      records: data.map((row) => formatAppointmentForApi(row)),
    });
  } catch (err) {
    console.error("appointment getAll:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const getById = async (req, res) => {
  try {
    const appointment = await resolveAppointmentByIdParam(req.params.id);
    if (!appointment) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Appointment not found.",
      });
    }

    const access = await assertAppointmentRecordAccess(req, appointment);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointment fetched successfully.",
      record: formatAppointmentForApi(appointment),
    });
  } catch (err) {
    console.error("appointment getById:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const getByOrder = async (req, res) => {
  try {
    const order = await resolveOrderByIdParam(req.params.orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Order not found.",
      });
    }

    const access = await assertOrderRecordAccess(req, order);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const appointments = await Appointment.find({
      order_id: order._id,
      deleted_at: null,
    })
      .sort({ service_date: -1, start_time: -1, created_at: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointments fetched successfully.",
      order_id: String(order._id),
      order_unique_id: order.unique_id,
      records: appointments.map((row) => formatAppointmentForApi(row)),
    });
  } catch (err) {
    console.error("appointment getByOrder:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const update = async (req, res) => {
  try {
    const result = await updateAppointmentById(req, req.params.id, req.body);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointment updated successfully.",
      record: formatAppointmentForApi(result.record),
    });
  } catch (err) {
    console.error("appointment update:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

const deleteAppointment = async (req, res) => {
  try {
    const result = await softDeleteAppointmentById(req, req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Appointment deleted successfully.",
    });
  } catch (err) {
    console.error("appointment delete:", err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal server error.",
    });
  }
};

module.exports = {
  create,
  getAll,
  getById,
  getByOrder,
  update,
  deleteAppointment,
};

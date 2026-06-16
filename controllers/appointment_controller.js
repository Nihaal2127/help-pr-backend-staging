const Appointment = require("../models/appointment");
const { formatAppointmentForApi } = require("../utils/appointment_api_format");
const {
  createAppointmentForOrder,
  updateAppointmentById,
  softDeleteAppointmentById,
  listAppointments,
  getAppointmentById,
  getAppointmentsByOrder,
} = require("../services/appointment_service");

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
    const result = await listAppointments(req.query, { req });
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
      message: result.message,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
      currentPage: result.currentPage,
      records: result.records,
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
    const result = await getAppointmentById(req.params.id, { req });
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
      message: result.message,
      record: result.record,
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
    const result = await getAppointmentsByOrder(req.params.orderId, { req });
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
      message: result.message,
      order_id: result.order_id,
      order_unique_id: result.order_unique_id,
      records: result.records,
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

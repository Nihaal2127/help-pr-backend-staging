const { ok, fail } = require("../../../utils/mobile_service_result");
const { formatAppointmentForApi } = require("../../../utils/appointment_api_format");
const {
  createAppointmentForOrder,
  updateAppointmentById,
  softDeleteAppointmentById,
  listAppointments,
  getAppointmentById,
  getAppointmentsByOrder,
} = require("../../../services/appointment_service");

const listPartnerAppointments = async (partnerId, query) => {
  try {
    const result = await listAppointments(query, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: result.message,
      data: {
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        currentPage: result.currentPage,
        limit: result.limit,
        records: result.records,
      },
    });
  } catch (err) {
    console.error("listPartnerAppointments:", err.message);
    return fail(500, "Internal server error.");
  }
};

const getPartnerAppointmentById = async (partnerId, appointmentId) => {
  try {
    const result = await getAppointmentById(appointmentId, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: result.message,
      record: result.record,
    });
  } catch (err) {
    console.error("getPartnerAppointmentById:", err.message);
    return fail(500, "Internal server error.");
  }
};

const getPartnerAppointmentsByOrder = async (partnerId, orderId) => {
  try {
    const result = await getAppointmentsByOrder(orderId, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: result.message,
      order_id: result.order_id,
      order_unique_id: result.order_unique_id,
      records: result.records,
    });
  } catch (err) {
    console.error("getPartnerAppointmentsByOrder:", err.message);
    return fail(500, "Internal server error.");
  }
};

const createPartnerAppointment = async (partnerId, body) => {
  try {
    const result = await createAppointmentForOrder(null, body, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: "Appointment created successfully.",
      record: formatAppointmentForApi(result.record),
    });
  } catch (err) {
    console.error("createPartnerAppointment:", err.message);
    return fail(500, "Internal server error.");
  }
};

const updatePartnerAppointment = async (partnerId, appointmentId, body) => {
  try {
    const result = await updateAppointmentById(null, appointmentId, body, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: "Appointment updated successfully.",
      record: formatAppointmentForApi(result.record),
    });
  } catch (err) {
    console.error("updatePartnerAppointment:", err.message);
    return fail(500, "Internal server error.");
  }
};

const deletePartnerAppointment = async (partnerId, appointmentId) => {
  try {
    const result = await softDeleteAppointmentById(null, appointmentId, { partnerId });
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(200, {
      message: "Appointment deleted successfully.",
    });
  } catch (err) {
    console.error("deletePartnerAppointment:", err.message);
    return fail(500, "Internal server error.");
  }
};

module.exports = {
  listPartnerAppointments,
  getPartnerAppointmentById,
  getPartnerAppointmentsByOrder,
  createPartnerAppointment,
  updatePartnerAppointment,
  deletePartnerAppointment,
};

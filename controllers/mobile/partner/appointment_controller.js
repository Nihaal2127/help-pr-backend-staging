const {
  validateCreateAppointmentBody,
  validateUpdateAppointmentBody,
} = require("../../../middleware/appointment_middleware");
const {
  listPartnerAppointments,
  getPartnerAppointmentById,
  getPartnerAppointmentsByOrder,
  createPartnerAppointment,
  updatePartnerAppointment,
  deletePartnerAppointment,
} = require("../../../services/mobile/partner/appointment_service");
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendRecordResult,
  sendServiceError,
} = require("../../../utils/mobile_controller_helpers");

const listHandler = wrapMobileHandler(
  "mobile partner appointment list handler",
  async (req, res) => {
    const result = await listPartnerAppointments(getCallerId(req), req.query);
    return sendPaginatedListFromData(res, result, { includeTodayCount: false });
  }
);

const getByOrderHandler = wrapMobileHandler(
  "mobile partner appointment list by order handler",
  async (req, res) => {
    const result = await getPartnerAppointmentsByOrder(
      getCallerId(req),
      req.params.orderId
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      order_id: result.data.order_id,
      order_unique_id: result.data.order_unique_id,
      records: result.data.records,
    });
  }
);

const getByIdHandler = wrapMobileHandler(
  "mobile partner appointment detail handler",
  async (req, res) => {
    const result = await getPartnerAppointmentById(
      getCallerId(req),
      req.params.appointmentId
    );
    return sendRecordResult(res, result);
  }
);

const createHandler = wrapMobileHandler(
  "mobile partner appointment create handler",
  async (req, res) => {
    const result = await createPartnerAppointment(getCallerId(req), req.body);
    return sendRecordResult(res, result);
  }
);

const updateHandler = wrapMobileHandler(
  "mobile partner appointment update handler",
  async (req, res) => {
    const result = await updatePartnerAppointment(
      getCallerId(req),
      req.params.appointmentId,
      req.body
    );
    return sendRecordResult(res, result);
  }
);

const deleteHandler = wrapMobileHandler(
  "mobile partner appointment delete handler",
  async (req, res) => {
    const result = await deletePartnerAppointment(
      getCallerId(req),
      req.params.appointmentId
    );
    if (!result.ok) {
      return sendServiceError(res, result);
    }
    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
    });
  }
);

module.exports = {
  listHandler,
  getByOrderHandler,
  getByIdHandler,
  createHandler,
  updateHandler,
  deleteHandler,
};

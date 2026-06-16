const Appointment = require("../models/appointment");
const Order = require("../models/order");
const OrderService = require("../models/order_services");
const User = require("../models/user");
const Service = require("../models/service");
const { getAppointmentId } = require("../helper/id_generator");
const { combineDateAndTime } = require("../utils/order_schedule");
const { parseFilterDate } = require("../utils/date_bounds");
const { escapeRegExp } = require("../utils/string_helpers");
const { isMongoObjectIdHex } = require("../utils/mongoose_helpers");
const { getCallerId } = require("../utils/auth_caller");
const {
  normalizeAppointmentStatus,
} = require("../enum/appointment_status_enum");
const {
  assertOrderRecordAccess,
  assertAppointmentRecordAccess,
} = require("../utils/appointment_access");

const parseTimeInput = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const match24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    const h = Number(match24[1]);
    const m = Number(match24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  return null;
};

const resolveOrderByIdParam = async (id) => {
  try {
    const trimmed = String(id ?? "").trim();
    if (!trimmed) return null;

    if (isMongoObjectIdHex(trimmed)) {
      const byId = await Order.findOne({ _id: trimmed, deleted_at: null });
      if (byId) return byId;
    }

    return Order.findOne({
      unique_id: new RegExp(`^${escapeRegExp(trimmed)}$`, "i"),
      deleted_at: null,
    });
  } catch (err) {
    console.error("resolveOrderByIdParam (appointment):", err.message);
    return null;
  }
};

const resolveAppointmentByIdParam = async (id) => {
  try {
    const trimmed = String(id ?? "").trim();
    if (!trimmed) return null;

    if (isMongoObjectIdHex(trimmed)) {
      const byId = await Appointment.findOne({ _id: trimmed, deleted_at: null });
      if (byId) return byId;
    }

    return Appointment.findOne({
      unique_id: new RegExp(`^${escapeRegExp(trimmed)}$`, "i"),
      deleted_at: null,
    });
  } catch (err) {
    console.error("resolveAppointmentByIdParam:", err.message);
    return null;
  }
};

const loadOrderContext = async (order) => {
  try {
    const [partner, service, serviceLine] = await Promise.all([
      order.partner_id
        ? User.findById(order.partner_id).select("name user_id").lean()
        : null,
      order.service_id
        ? Service.findById(order.service_id).select("name service_id").lean()
        : null,
      OrderService.findOne({ order_id: order._id, deleted_at: null })
        .sort({ created_at: 1 })
        .lean(),
    ]);

    return { partner, service, serviceLine };
  } catch (err) {
    console.error("loadOrderContext:", err.message);
    return { partner: null, service: null, serviceLine: null };
  }
};

const resolveScheduleFromOrder = (order, serviceLine) => {
  const serviceDate =
    serviceLine?.service_date ||
    order.from_date ||
    order.order_date ||
    null;

  let startTime = serviceLine?.service_from_time || null;
  let endTime = serviceLine?.service_to_time || null;

  if (!startTime && serviceDate && order.work_start_time) {
    startTime = combineDateAndTime(serviceDate, order.work_start_time);
  }
  if (!endTime && serviceDate && order.work_end_time) {
    endTime = combineDateAndTime(serviceDate, order.work_end_time);
  }

  return { serviceDate, startTime, endTime };
};

/** undefined = omit field; null = clear; string = normalize or invalid */
const resolveOptionalStatus = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return normalizeAppointmentStatus(value);
};

const buildAppointmentPayloadFromOrder = async (
  order,
  {
    title,
    serviceDate,
    startTime,
    endTime,
    status,
    source,
    createdById,
  }
) => {
  const { partner, service, serviceLine } = await loadOrderContext(order);
  const schedule = resolveScheduleFromOrder(order, serviceLine);

  const resolvedServiceDate = serviceDate ?? schedule.serviceDate;
  const resolvedTitle =
    String(title || "").trim() ||
    (service?.name ? `${service.name} — ${order.unique_id}` : `Order ${order.unique_id}`);

  const resolvedStatus = resolveOptionalStatus(status);

  const payload = {
    order_id: order._id,
    order_unique_id: order.unique_id || "",
    user_id: order.user_id ?? null,
    partner_id: order.partner_id ?? null,
    partner_name: partner?.name || "",
    employee_id: order.employee_id ?? null,
    franchise_id: order.franchise_id ?? null,
    service_id: order.service_id ?? null,
    service_name: service?.name || "",
    title: resolvedTitle,
    service_date: resolvedServiceDate ? new Date(resolvedServiceDate) : null,
    start_time: startTime ?? schedule.startTime ?? null,
    end_time: endTime ?? schedule.endTime ?? null,
    source: source === "auto" ? "auto" : "manual",
    created_by_id: createdById ?? order.created_by_id ?? null,
  };

  if (resolvedStatus !== undefined) {
    payload.status = resolvedStatus;
  }

  return payload;
};

const createDefaultAppointmentForOrder = async (order, { actorUserId } = {}) => {
  if (!order?._id) return null;

  const existingAuto = await Appointment.findOne({
    order_id: order._id,
    source: "auto",
    deleted_at: null,
  }).lean();
  if (existingAuto) {
    return existingAuto;
  }

  const payload = await buildAppointmentPayloadFromOrder(order, {
    source: "auto",
    createdById: actorUserId || order.created_by_id || null,
  });

  const unique_id = await getAppointmentId();
  const appointment = new Appointment({
    unique_id,
    ...payload,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await appointment.save();
  return appointment;
};

/**
 * Fire-and-forget wrapper: never throws; order creation must not fail.
 */
const safeCreateDefaultAppointmentForOrder = async (order, options = {}) => {
  try {
    return await createDefaultAppointmentForOrder(order, options);
  } catch (err) {
    console.error("safeCreateDefaultAppointmentForOrder:", err.message);
    return null;
  }
};

const validateManualScheduleInput = ({ service_date, start_time, end_time }) => {
  const parsedDate = parseFilterDate(service_date);
  if (!parsedDate) {
    return { ok: false, status: 400, message: "Valid service_date is required." };
  }

  const startStr = parseTimeInput(start_time);
  const endStr = parseTimeInput(end_time);

  if (start_time != null && String(start_time).trim() !== "" && !startStr) {
    return { ok: false, status: 400, message: "Invalid start_time. Use HH:mm format." };
  }
  if (end_time != null && String(end_time).trim() !== "" && !endStr) {
    return { ok: false, status: 400, message: "Invalid end_time. Use HH:mm format." };
  }

  const startDateTime = startStr ? combineDateAndTime(parsedDate, startStr) : null;
  const endDateTime = endStr ? combineDateAndTime(parsedDate, endStr) : null;

  if (startDateTime && endDateTime && endDateTime <= startDateTime) {
    return { ok: false, status: 400, message: "end_time must be after start_time." };
  }

  return {
    ok: true,
    serviceDate: parsedDate,
    startDateTime,
    endDateTime,
  };
};

const createAppointmentForOrder = async (req, body) => {
  try {
    const order = await resolveOrderByIdParam(body.order_id);
    if (!order) {
      return { ok: false, status: 404, message: "Order not found." };
    }

    const access = await assertOrderRecordAccess(req, order);
    if (!access.ok) {
      return { ok: false, status: access.status, message: access.message };
    }

    const scheduleCheck = validateManualScheduleInput(body);
    if (!scheduleCheck.ok) {
      return scheduleCheck;
    }

    if (
      body.status !== undefined &&
      body.status !== null &&
      String(body.status).trim() !== "" &&
      !normalizeAppointmentStatus(body.status)
    ) {
      return {
        ok: false,
        status: 400,
        message: "Invalid status. Use scheduled, in-progress, completed, or cancelled.",
      };
    }

    const callerId = getCallerId(req);
    const payload = await buildAppointmentPayloadFromOrder(order, {
      title: body.title,
      serviceDate: scheduleCheck.serviceDate,
      startTime: scheduleCheck.startDateTime,
      endTime: scheduleCheck.endDateTime,
      status: body.status,
      source: "manual",
      createdById: callerId,
    });

    const unique_id = await getAppointmentId();
    const appointment = new Appointment({
      unique_id,
      ...payload,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await appointment.save();
    return { ok: true, record: appointment };
  } catch (err) {
    console.error("createAppointmentForOrder:", err.message);
    return { ok: false, status: 500, message: "Internal server error." };
  }
};

const updateAppointmentById = async (req, id, body) => {
  try {
    const appointment = await resolveAppointmentByIdParam(id);
    if (!appointment) {
      return { ok: false, status: 404, message: "Appointment not found." };
    }

    const access = await assertAppointmentRecordAccess(req, appointment);
    if (!access.ok) {
      return { ok: false, status: access.status, message: access.message };
    }

    if (body.title !== undefined) {
      appointment.title = String(body.title || "").trim();
    }

    if (
      body.service_date !== undefined ||
      body.start_time !== undefined ||
      body.end_time !== undefined
    ) {
      const serviceDateRaw =
        body.service_date !== undefined
          ? body.service_date
          : appointment.service_date;
      const startRaw =
        body.start_time !== undefined ? body.start_time : appointment.start_time;
      const endRaw =
        body.end_time !== undefined ? body.end_time : appointment.end_time;

      const scheduleCheck = validateManualScheduleInput({
        service_date: serviceDateRaw,
        start_time:
          startRaw instanceof Date
            ? `${String(startRaw.getHours()).padStart(2, "0")}:${String(startRaw.getMinutes()).padStart(2, "0")}`
            : startRaw,
        end_time:
          endRaw instanceof Date
            ? `${String(endRaw.getHours()).padStart(2, "0")}:${String(endRaw.getMinutes()).padStart(2, "0")}`
            : endRaw,
      });

      if (!scheduleCheck.ok) {
        return scheduleCheck;
      }

      appointment.service_date = scheduleCheck.serviceDate;
      appointment.start_time = scheduleCheck.startDateTime;
      appointment.end_time = scheduleCheck.endDateTime;
    }

    if (body.status !== undefined) {
      const resolvedStatus = resolveOptionalStatus(body.status);
      if (
        body.status !== null &&
        String(body.status).trim() !== "" &&
        resolvedStatus === null
      ) {
        return {
          ok: false,
          status: 400,
          message: "Invalid status. Use scheduled, in-progress, completed, or cancelled.",
        };
      }
      appointment.status = resolvedStatus;
    }

    appointment.updated_at = new Date();
    await appointment.save();
    return { ok: true, record: appointment };
  } catch (err) {
    console.error("updateAppointmentById:", err.message);
    return { ok: false, status: 500, message: "Internal server error." };
  }
};

const softDeleteAppointmentById = async (req, id) => {
  try {
    const appointment = await resolveAppointmentByIdParam(id);
    if (!appointment) {
      return { ok: false, status: 404, message: "Appointment not found." };
    }

    const access = await assertAppointmentRecordAccess(req, appointment);
    if (!access.ok) {
      return { ok: false, status: access.status, message: access.message };
    }

    appointment.deleted_at = new Date();
    appointment.updated_at = new Date();
    await appointment.save();
    return { ok: true };
  } catch (err) {
    console.error("softDeleteAppointmentById:", err.message);
    return { ok: false, status: 500, message: "Internal server error." };
  }
};

module.exports = {
  safeCreateDefaultAppointmentForOrder,
  createDefaultAppointmentForOrder,
  createAppointmentForOrder,
  updateAppointmentById,
  softDeleteAppointmentById,
  resolveOrderByIdParam,
  resolveAppointmentByIdParam,
  validateManualScheduleInput,
};

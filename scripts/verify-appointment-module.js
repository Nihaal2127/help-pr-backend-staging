/**
 * Smoke-test appointment helpers (no DB).
 * Run: node scripts/verify-appointment-module.js
 */
const { formatAppointmentForApi } = require("../utils/appointment_api_format");
const { combineDateAndTime } = require("../utils/order_schedule");
const { parseFilterDate } = require("../utils/date_bounds");
const {
  normalizeAppointmentStatus,
  isValidAppointmentStatus,
} = require("../enum/appointment_status_enum");

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const parsedDate = parseFilterDate("2026-06-17");
const start = combineDateAndTime(parsedDate, "09:00");
const end = combineDateAndTime(parsedDate, "11:00");
assert(start && end && start < end, "schedule times combine");

assert(isValidAppointmentStatus("scheduled"), "scheduled status");
assert(normalizeAppointmentStatus("Scheduled") === "scheduled", "normalize case");
assert(!isValidAppointmentStatus("pending"), "invalid status rejected");

const formatted = formatAppointmentForApi({
  _id: "507f1f77bcf86cd799439011",
  order_id: "507f1f77bcf86cd799439012",
  service_date: new Date("2026-06-17T00:00:00.000Z"),
  start_time: new Date("2026-06-17T09:30:00.000Z"),
  end_time: new Date("2026-06-17T11:00:00.000Z"),
  title: "Test",
});
assert(formatted.service_date === "2026-06-17", "date formatted");
assert(typeof formatted._id === "string", "id serialized");
assert(typeof formatted.order_id === "string", "order_id serialized");

console.log("verify-appointment-module: OK");

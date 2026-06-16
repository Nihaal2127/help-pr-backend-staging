const APPOINTMENT_STATUS_SCHEDULED = "scheduled";
const APPOINTMENT_STATUS_IN_PROGRESS = "in-progress";
const APPOINTMENT_STATUS_COMPLETED = "completed";
const APPOINTMENT_STATUS_CANCELLED = "cancelled";

const APPOINTMENT_STATUSES = [
  APPOINTMENT_STATUS_SCHEDULED,
  APPOINTMENT_STATUS_IN_PROGRESS,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_CANCELLED,
];

const DEFAULT_APPOINTMENT_STATUS = APPOINTMENT_STATUS_SCHEDULED;

const STATUS_ALIASES = {
  schedule: APPOINTMENT_STATUS_SCHEDULED,
  "in progress": APPOINTMENT_STATUS_IN_PROGRESS,
  inprogress: APPOINTMENT_STATUS_IN_PROGRESS,
  complete: APPOINTMENT_STATUS_COMPLETED,
  canceled: APPOINTMENT_STATUS_CANCELLED,
  cancel: APPOINTMENT_STATUS_CANCELLED,
};

const normalizeAppointmentStatus = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (APPOINTMENT_STATUSES.includes(raw)) return raw;
  if (STATUS_ALIASES[raw]) return STATUS_ALIASES[raw];
  return null;
};

const isValidAppointmentStatus = (value) =>
  normalizeAppointmentStatus(value) !== null;

const getAppointmentStatusLabel = (status) => {
  const normalized = normalizeAppointmentStatus(status);
  if (!normalized) return "";
  return normalized
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
};

module.exports = {
  APPOINTMENT_STATUS_SCHEDULED,
  APPOINTMENT_STATUS_IN_PROGRESS,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_CANCELLED,
  APPOINTMENT_STATUSES,
  DEFAULT_APPOINTMENT_STATUS,
  normalizeAppointmentStatus,
  isValidAppointmentStatus,
  getAppointmentStatusLabel,
};

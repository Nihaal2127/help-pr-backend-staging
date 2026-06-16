const { formatDateOnly } = require("./dateFormatter");

const objectIdBytesToHex = (bytes) => Buffer.from(bytes).toString("hex");

const serializeObjectId = (value) => {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value.buffer?.type === "Buffer" &&
    Array.isArray(value.buffer.data)
  ) {
    return objectIdBytesToHex(value.buffer.data);
  }
  if (typeof value.toHexString === "function") return value.toHexString();
  if (typeof value.toString === "function" && value._bsontype === "ObjectId") {
    return value.toString();
  }
  return value;
};

const OBJECT_ID_KEYS = [
  "_id",
  "order_id",
  "user_id",
  "partner_id",
  "employee_id",
  "franchise_id",
  "service_id",
  "created_by_id",
];

const formatTimeOnly = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

const formatAppointmentForApi = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  const plain =
    typeof doc.toObject === "function"
      ? doc.toObject({ virtuals: true })
      : { ...doc };

  for (const key of OBJECT_ID_KEYS) {
    if (plain[key] != null) {
      plain[key] = serializeObjectId(plain[key]);
    }
  }

  if (plain.service_date != null) {
    plain.service_date = formatDateOnly(plain.service_date);
  }
  if (plain.start_time != null) {
    plain.start_time = formatTimeOnly(plain.start_time);
  }
  if (plain.end_time != null) {
    plain.end_time = formatTimeOnly(plain.end_time);
  }

  return plain;
};

module.exports = {
  formatAppointmentForApi,
  formatTimeOnly,
};

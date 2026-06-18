const { formatDateOnly } = require('./dateFormatter');

const ORDER_CALENDAR_DATE_KEYS = ['from_date', 'to_date', 'order_date'];
const QUOTE_EMBED_CALENDAR_DATE_KEYS = ['from_date', 'to_date'];
const SERVICE_LINE_CALENDAR_DATE_KEYS = ['service_date'];

const toPlainObject = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true });
  }
  return { ...doc };
};

const applyCalendarDateFields = (target, keys) => {
  for (const key of keys) {
    if (!(key in target)) continue;
    if (target[key] == null || target[key] === '') continue;
    target[key] = formatDateOnly(target[key]);
  }
  return target;
};

const formatQuoteEmbedForApi = (quote) => {
  if (!quote || typeof quote !== 'object') return quote;
  return applyCalendarDateFields({ ...quote }, QUOTE_EMBED_CALENDAR_DATE_KEYS);
};

const objectIdBytesToHex = (bytes) => Buffer.from(bytes).toString('hex');

/** Normalize Mongo ObjectId / Buffer leak to a 24-char hex string. */
const serializeObjectId = (value) => {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.buffer?.type === 'Buffer' && Array.isArray(value.buffer.data)) {
    return objectIdBytesToHex(value.buffer.data);
  }
  if (typeof value.toHexString === 'function') return value.toHexString();
  if (typeof value.toString === 'function' && value._bsontype === 'ObjectId') {
    return value.toString();
  }
  return value;
};

const formatOrderServiceItemForApi = (item) => {
  if (item == null) return item;
  if (typeof item !== 'object') return item;

  // Unpopulated ObjectId serialized as { buffer: { type, data } } from aggregate JSON.
  if (item.buffer?.type === 'Buffer' && Array.isArray(item.buffer.data) && item._id == null) {
    return { _id: objectIdBytesToHex(item.buffer.data) };
  }

  const id = serializeObjectId(item._id ?? item);
  if (typeof item === 'object' && item._id == null && typeof id === 'string') {
    return { _id: id };
  }

  const plain = toPlainObject(item);
  if (plain._id != null) plain._id = serializeObjectId(plain._id);
  if (plain.order_id != null) plain.order_id = serializeObjectId(plain.order_id);
  return applyCalendarDateFields(plain, SERVICE_LINE_CALENDAR_DATE_KEYS);
};

/**
 * Format order documents for API responses: calendar fields as YYYY-MM-DD.
 * Execution datetimes (service_from_time, service_to_time, paid_at, etc.) stay ISO.
 */
const formatOrderForApi = (order) => {
  if (!order) return order;
  const plain = toPlainObject(order);
  if (plain._id != null) plain._id = serializeObjectId(plain._id);
  if (plain.chat_id != null) plain.chat_id = serializeObjectId(plain.chat_id);
  applyCalendarDateFields(plain, ORDER_CALENDAR_DATE_KEYS);
  if (plain.quote_info) {
    plain.quote_info = formatQuoteEmbedForApi(plain.quote_info);
  }
  if (Array.isArray(plain.service_items)) {
    plain.service_items = plain.service_items.map(formatOrderServiceItemForApi);
  }
  return plain;
};

const formatOrderRecords = (records) => {
  if (!Array.isArray(records)) return records;
  return records.map(formatOrderForApi);
};

module.exports = {
  formatOrderForApi,
  formatOrderRecords,
  formatOrderServiceItemForApi,
  formatQuoteEmbedForApi,
  serializeObjectId,
};

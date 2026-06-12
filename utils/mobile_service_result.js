const fail = (status, message, extra = {}) => ({ ok: false, status, message, ...extra });

const ok = (status, data) => ({ ok: true, status, data });

/** Top-level message shape used by mobile user auth and similar services. */
const okWithMessage = (status, message, extra = {}) => ({
  ok: true,
  status,
  message,
  ...extra,
});

/** `{ ok: true, data }` shape used by partner login/update. */
const okWithData = (data) => ({ ok: true, data });

/** Internal success with no payload. */
const okPass = () => ({ ok: true });

const parsePositiveInt = (raw, fallback) => {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseOptionalBoolean = (raw) => {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: true, value: null };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') return { ok: true, value: true };
  if (normalized === 'false') return { ok: true, value: false };
  return { ok: false, message: 'Invalid is_paid filter. Use true or false.' };
};

const mergeMongoFilters = (...parts) => {
  const filters = parts.filter((part) => part && Object.keys(part).length > 0);
  if (filters.length === 0) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
};

module.exports = {
  fail,
  ok,
  okWithMessage,
  okWithData,
  okPass,
  parsePositiveInt,
  parseOptionalBoolean,
  mergeMongoFilters,
};

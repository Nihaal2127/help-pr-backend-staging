const POST_TYPE_ORDER = 'order';
const POST_TYPE_LEGACY_WORK = 'legacy_work';

const POST_TYPES = [POST_TYPE_ORDER, POST_TYPE_LEGACY_WORK];

const normalizePostType = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (POST_TYPES.includes(s)) return s;
  return null;
};

module.exports = {
  POST_TYPE_ORDER,
  POST_TYPE_LEGACY_WORK,
  POST_TYPES,
  normalizePostType,
};

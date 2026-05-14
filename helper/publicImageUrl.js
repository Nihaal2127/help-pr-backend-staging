/**
 * Prefix relative stored paths with IMAGE_CDN_BASE_URL so clients receive full HTTPS URLs.
 * Leaves absolute http(s) URLs and data: URIs unchanged.
 */

const IMAGE_FIELD_KEYS = new Set([
  'image_url',
  'profile_url',
  'document_image',
  'service_image',
]);

const getCdnBase = () =>
  String(process.env.IMAGE_CDN_BASE_URL || process.env.CDN_BASE_URL || '').replace(
    /\/+$/,
    ''
  );

const toPublicImageUrl = (value) => {
  if (value == null) return value;
  const s = String(value).trim();
  if (!s) return value;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:/i.test(s)) return s;
  const base = getCdnBase();
  if (!base) return value;
  const path = s.replace(/^\/+/, '');
  return `${base}/${path}`;
};

const isPlainObject = (val) => {
  if (val === null || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
};

const deepApplyPublicImageUrls = (value) => {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepApplyPublicImageUrls(item));
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (!isPlainObject(value)) return value;

  const out = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (IMAGE_FIELD_KEYS.has(key) && typeof v === 'string') {
      out[key] = toPublicImageUrl(v);
    } else {
      out[key] = deepApplyPublicImageUrls(v);
    }
  }
  return out;
};

module.exports = {
  toPublicImageUrl,
  deepApplyPublicImageUrls,
  getCdnBase,
  IMAGE_FIELD_KEYS,
};

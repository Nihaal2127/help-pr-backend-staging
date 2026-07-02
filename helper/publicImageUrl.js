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

/** Startup diagnostics — check CloudWatch on Lambda cold start or local console on boot. */
const logPublicImageUrlConfig = () => {
  const imageCdn = process.env.IMAGE_CDN_BASE_URL || '';
  const cdnBase = process.env.CDN_BASE_URL || '';
  const resolved = getCdnBase();
  const s3Bucket = process.env.AWS_S3_BUCKET || '';
  const sampleKey = 'category/example.png';
  const sampleUrl = toPublicImageUrl(sampleKey);

  const source = imageCdn
    ? 'IMAGE_CDN_BASE_URL'
    : cdnBase
      ? 'CDN_BASE_URL'
      : '(none)';

  console.log('[publicImageUrl] Image URL config:', {
    source,
    IMAGE_CDN_BASE_URL: imageCdn || '(unset)',
    CDN_BASE_URL: cdnBase || '(unset)',
    resolvedCdnBase: resolved || '(unset)',
    AWS_S3_BUCKET: s3Bucket || '(unset)',
    sampleInput: sampleKey,
    sampleOutput: sampleUrl,
  });

  if (resolved && !/^https?:\/\//i.test(resolved)) {
    console.warn(
      '[publicImageUrl] resolvedCdnBase is not a full URL (missing https://). Image links may not load in clients.'
    );
  }
  if (resolved && s3Bucket && resolved === s3Bucket) {
    console.warn(
      '[publicImageUrl] resolvedCdnBase equals AWS_S3_BUCKET — use CloudFront/S3 HTTPS URL for IMAGE_CDN_BASE_URL instead.'
    );
  }
};

module.exports = {
  toPublicImageUrl,
  deepApplyPublicImageUrls,
  getCdnBase,
  logPublicImageUrlConfig,
  IMAGE_FIELD_KEYS,
};

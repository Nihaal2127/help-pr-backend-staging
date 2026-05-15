const STATUS_PENDING = 1;
const STATUS_APPROVED = 2;
const STATUS_REJECTED = 3;
const STATUS_CONVERTED = 4;
const STATUS_CANCELLED = 5;
const STATUS_EXPIRED = 6;

const QuoteStatus = new Map([
  [STATUS_PENDING, "Pending"],
  [STATUS_APPROVED, "Approved"],
  [STATUS_REJECTED, "Rejected"],
  [STATUS_CONVERTED, "Converted"],
  [STATUS_CANCELLED, "Cancelled"],
  [STATUS_EXPIRED, "Expired"],
]);

/** Dashboard list / getCount buckets (GET /api/quote/getAll?status=...) */
const QUOTE_DASHBOARD_BUCKETS = [
  "new",
  "pending",
  "accepted",
  "success",
  "failed",
];

const hasRef = (val) => {
  if (val == null || val === "") return false;
  if (typeof val === "object" && val._id != null) return true;
  if (typeof val === "string" && /^[a-fA-F0-9]{24}$/i.test(val.trim())) {
    return true;
  }
  if (typeof val === "object" && typeof val.toString === "function") {
    const s = val.toString();
    if (/^[a-fA-F0-9]{24}$/i.test(s)) return true;
  }
  return false;
};

/**
 * UI bucket for a quote row — same rules as POST /api/getCount type quote-management
 * and GET /api/quote/getCounts.
 */
const getQuoteDashboardStatus = (quote = {}) => {
  const status = Number(quote.status);
  const partnerSet = hasRef(quote.partner_id);
  const orderSet = hasRef(quote.order_id);

  if (status === STATUS_PENDING) {
    return partnerSet ? "pending" : "new";
  }
  if (status === STATUS_CONVERTED && orderSet) {
    return "success";
  }
  if (status === STATUS_APPROVED && !orderSet) {
    return "failed";
  }
  if (status === STATUS_APPROVED || status === STATUS_CONVERTED) {
    return "accepted";
  }
  if (status === STATUS_REJECTED) return "rejected";
  if (status === STATUS_CANCELLED) return "cancelled";
  if (status === STATUS_EXPIRED) return "expired";
  return "";
};

const buildQuoteBucketFilter = (bucket) => {
  switch (bucket) {
    case "new":
      return { status: STATUS_PENDING, partner_id: null };
    case "pending":
      return { status: STATUS_PENDING, partner_id: { $ne: null } };
    case "accepted":
      return { status: { $in: [STATUS_APPROVED, STATUS_CONVERTED] } };
    case "success":
      return { status: STATUS_CONVERTED, order_id: { $ne: null } };
    case "failed":
      return { status: STATUS_APPROVED, order_id: null };
    default:
      return null;
  }
};

const getQuoteStatus = (key) => QuoteStatus.get(Number(key)) || "";

const getQuoteStatusKey = (value) => {
  for (const [key, val] of QuoteStatus.entries()) {
    if (val === value) return key;
  }
  return null;
};

/** Shape quote records for API: string dashboard status + numeric status_code. */
const formatQuoteForApi = (quote) => {
  if (!quote || typeof quote !== "object") return quote;

  const plain =
    typeof quote.toObject === "function"
      ? quote.toObject({ virtuals: true })
      : { ...quote };

  const statusCode = Number(plain.status);
  if (!Number.isNaN(statusCode)) {
    plain.status_code = statusCode;
    plain.status = getQuoteDashboardStatus(plain);
  }

  return plain;
};

const formatQuoteRecords = (records) => {
  if (!Array.isArray(records)) return records;
  return records.map(formatQuoteForApi);
};

module.exports = {
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED,
  STATUS_CONVERTED,
  STATUS_CANCELLED,
  STATUS_EXPIRED,
  QUOTE_DASHBOARD_BUCKETS,
  QuoteStatus,
  getQuoteStatus,
  getQuoteStatusKey,
  getQuoteDashboardStatus,
  buildQuoteBucketFilter,
  hasRef,
  formatQuoteForApi,
  formatQuoteRecords,
};

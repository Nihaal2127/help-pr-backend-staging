const { formatDateOnly } = require("../utils/dateFormatter");
const { attachPartnerRatingFields } = require("../utils/rating_format");

const QUOTE_STATUSES = ["new", "pending", "accepted", "success", "failed"];

const QUOTE_DASHBOARD_BUCKETS = [...QUOTE_STATUSES];

const TERMINAL_QUOTE_STATUSES = new Set(["success", "failed"]);

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

/** Legacy numeric DB values (1–6) → string status for reads and filters. */
const legacyNumericToStatus = (code, quote = {}) => {
  const n = Number(code);
  const partnerSet = hasRef(quote.partner_id);
  const orderSet = hasRef(quote.order_id);

  switch (n) {
    case 1:
      return partnerSet ? "pending" : "new";
    case 2:
      return orderSet ? "success" : "accepted";
    case 3:
    case 5:
    case 6:
      return "failed";
    case 4:
      return orderSet ? "success" : "accepted";
    default:
      return "";
  }
};

const normalizeQuoteStatus = (status, quote = {}) => {
  if (status === undefined || status === null) return "";

  if (typeof status === "string") {
    const key = status.trim().toLowerCase();
    if (key === "fail") return "failed";
    if (QUOTE_STATUSES.includes(key)) return key;
    if (/^\d+$/.test(key)) {
      return legacyNumericToStatus(parseInt(key, 10), quote);
    }
    return "";
  }

  if (typeof status === "number" && !Number.isNaN(status)) {
    return legacyNumericToStatus(status, quote);
  }

  return "";
};

const resolveQuoteStatus = (quote = {}) =>
  normalizeQuoteStatus(quote.status, quote);

const buildQuoteBucketFilter = (bucket) => {
  const key = bucket === "fail" ? "failed" : String(bucket || "").toLowerCase();
  if (!QUOTE_STATUSES.includes(key)) return null;

  const legacyFilters = {
    new: { status: 1, partner_id: null },
    pending: { status: 1, partner_id: { $ne: null } },
    accepted: { status: { $in: [2, 4] }, order_id: null },
    success: { status: 4, order_id: { $ne: null } },
    failed: {
      $or: [
        { status: { $in: [3, 5, 6] } },
        { status: 2, order_id: null },
      ],
    },
  };

  const legacy = legacyFilters[key];
  if (legacy) {
    return { $or: [{ status: key }, legacy] };
  }
  return { status: key };
};

const canTransitionQuoteStatus = (fromStatus, toStatus) => {
  const from = normalizeQuoteStatus(fromStatus);
  const to = normalizeQuoteStatus(toStatus);
  if (!from || !to) return false;
  if (from === to) return true;
  if (TERMINAL_QUOTE_STATUSES.has(from)) return false;

  const allowed = {
    new: ["pending", "accepted", "failed"],
    pending: ["new", "accepted", "failed"],
    accepted: ["success", "failed"],
  };

  return (allowed[from] || []).includes(to);
};

const formatQuoteForApi = (quote) => {
  if (!quote || typeof quote !== "object") return quote;

  const plain =
    typeof quote.toObject === "function"
      ? quote.toObject({ virtuals: true })
      : { ...quote };

  const resolved = resolveQuoteStatus(plain);
  if (resolved) {
    plain.status = resolved;
  }

  if (plain.from_date != null && plain.from_date !== "") {
    plain.from_date = formatDateOnly(plain.from_date);
  }
  if (plain.to_date != null && plain.to_date !== "") {
    plain.to_date = formatDateOnly(plain.to_date);
  }

  if (
    plain.partner_id &&
    typeof plain.partner_id === "object" &&
    plain.partner_id._id != null
  ) {
    plain.partner_id = {
      ...plain.partner_id,
      ...attachPartnerRatingFields(plain.partner_id),
    };
  }

  return plain;
};

const formatQuoteRecords = (records) => {
  if (!Array.isArray(records)) return records;
  return records.map(formatQuoteForApi);
};

module.exports = {
  QUOTE_STATUSES,
  QUOTE_DASHBOARD_BUCKETS,
  TERMINAL_QUOTE_STATUSES,
  normalizeQuoteStatus,
  resolveQuoteStatus,
  buildQuoteBucketFilter,
  canTransitionQuoteStatus,
  formatQuoteForApi,
  formatQuoteRecords,
};

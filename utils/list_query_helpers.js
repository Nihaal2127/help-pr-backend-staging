const { sanitizeInput } = require("../validator/search_keyword_validator");

const resolveSortField = (sortBy, whitelist, defaultField = "created_at") => {
  const sb = String(sortBy || "").trim();
  return whitelist.has(sb) ? sb : defaultField;
};

const resolveSortDir = (req) => {
  const so = String(req.query.sort_order || "").toLowerCase();
  if (so === "asc") return 1;
  if (so === "desc") return -1;
  if (req.query.sort !== undefined) {
    const s = parseInt(req.query.sort, 10);
    return s === 1 ? 1 : -1;
  }
  return -1;
};

/**
 * Empty / missing status param → no filter; invalid → { ok: false, message }.
 * @param {*} statusParam
 * @param {{ buildFilter: (raw: string) => object|null, invalidMessage: string }} options
 */
const resolveListStatusFilter = (statusParam, { buildFilter, invalidMessage }) => {
  if (statusParam === undefined || statusParam === null) {
    return { ok: true, filter: {} };
  }

  const raw = String(statusParam).trim();
  if (raw === "") {
    return { ok: true, filter: {} };
  }

  const statusFilter = buildFilter(raw);
  if (!statusFilter) {
    return { ok: false, message: invalidMessage };
  }

  return { ok: true, filter: statusFilter };
};

/**
 * Case-insensitive RegExp from ?search= (and optional legacy ?keyword=).
 */
const resolveListSearchRegex = (req, { legacyKeyword = false } = {}) => {
  const rawSearch = req.query.search;
  const legacy =
    legacyKeyword &&
    req.query.keyword !== undefined &&
    req.query.keyword !== null &&
    String(req.query.keyword).trim() !== ""
      ? String(req.query.keyword).trim()
      : "";

  const searchTerm =
    rawSearch !== undefined &&
    rawSearch !== null &&
    String(rawSearch).trim() !== ""
      ? sanitizeInput(String(rawSearch).trim())
      : legacy
        ? sanitizeInput(legacy)
        : "";

  return searchTerm ? new RegExp(searchTerm, "i") : null;
};

module.exports = {
  resolveSortField,
  resolveSortDir,
  resolveListStatusFilter,
  resolveListSearchRegex,
};

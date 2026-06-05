const { parseFilterDate, startOfUtcDay, endOfUtcDay } = require("./date_bounds");

const hasDateQueryParam = (query, key) =>
  query[key] !== undefined &&
  query[key] !== null &&
  String(query[key]).trim() !== "";

/**
 * Parse from_date / to_date query params into UTC day bounds.
 */
const buildScheduleDateRangeCore = (query) => {
  const hasFrom = hasDateQueryParam(query, "from_date");
  const hasTo = hasDateQueryParam(query, "to_date");

  if (!hasFrom && !hasTo) {
    return { ok: true, noDateParams: true };
  }

  const parsedFrom = hasFrom ? parseFilterDate(query.from_date) : null;
  const parsedTo = hasTo ? parseFilterDate(query.to_date) : null;

  if (hasFrom && !parsedFrom) {
    return { ok: false, message: "Invalid from date filter." };
  }
  if (hasTo && !parsedTo) {
    return { ok: false, message: "Invalid to date filter." };
  }

  let rangeFrom = parsedFrom ? startOfUtcDay(parsedFrom) : null;
  let rangeTo = parsedTo ? endOfUtcDay(parsedTo) : null;

  return { ok: true, rangeFrom, rangeTo, hasFrom, hasTo, parsedFrom, parsedTo };
};

/** Quotes: schedule window overlap (from_date / to_date on document). */
const buildQuoteDateRangeFilter = (query) => {
  const core = buildScheduleDateRangeCore(query);
  if (!core.ok) return core;
  if (core.noDateParams) {
    return { ok: true, filter: {} };
  }

  const { rangeFrom, rangeTo } = core;

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: "To date filter must be on or after from date filter.",
    };
  }

  const filter = {};
  if (rangeFrom) {
    filter.to_date = { $gte: rangeFrom };
  }
  if (rangeTo) {
    filter.from_date = { $lte: rangeTo };
  }

  return { ok: true, filter };
};

/** Quotes scheduled on the current UTC calendar day (overlap with today). */
const buildQuoteTodayOverlapFilter = () => {
  const today = new Date().toISOString().slice(0, 10);
  return buildQuoteDateRangeFilter({ from_date: today, to_date: today });
};

/** Orders: overlap + partial dates + order_date fallback; single-day when one param. */
const buildOrderDateRangeFilter = (query) => {
  const core = buildScheduleDateRangeCore(query);
  if (!core.ok) return core;
  if (core.noDateParams) {
    return { ok: true, filter: {} };
  }

  const { rangeFrom: initialFrom, rangeTo: initialTo, hasFrom, hasTo, parsedFrom, parsedTo } =
    core;

  let rangeFrom = initialFrom;
  let rangeTo = initialTo;

  if (hasFrom && !hasTo && parsedFrom) {
    rangeTo = endOfUtcDay(parsedFrom);
  } else if (!hasFrom && hasTo && parsedTo) {
    rangeFrom = startOfUtcDay(parsedTo);
  }

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: "To date filter must be on or after from date filter.",
    };
  }

  const branches = [
    {
      from_date: { $ne: null, $lte: rangeTo },
      to_date: { $ne: null, $gte: rangeFrom },
    },
    {
      $and: [
        { from_date: { $ne: null, $gte: rangeFrom, $lte: rangeTo } },
        { $or: [{ to_date: null }, { to_date: { $exists: false } }] },
      ],
    },
    {
      $and: [
        { to_date: { $ne: null, $gte: rangeFrom, $lte: rangeTo } },
        { $or: [{ from_date: null }, { from_date: { $exists: false } }] },
      ],
    },
    { order_date: { $gte: rangeFrom, $lte: rangeTo } },
  ];

  return { ok: true, filter: { $or: branches } };
};

/** Orders scheduled on the current UTC calendar day (overlap with today). */
const buildOrderTodayOverlapFilter = () => {
  const today = new Date().toISOString().slice(0, 10);
  return buildOrderDateRangeFilter({ from_date: today, to_date: today });
};

/** Single timestamp field: from_date / to_date inclusive UTC day bounds; one param = that day only. */
const buildFieldDateRangeFilter = (query, fieldName) => {
  const core = buildScheduleDateRangeCore(query);
  if (!core.ok) return core;
  if (core.noDateParams) {
    return { ok: true, filter: {} };
  }

  let { rangeFrom, rangeTo, hasFrom, hasTo, parsedFrom, parsedTo } = core;

  if (hasFrom && !hasTo && parsedFrom) {
    rangeTo = endOfUtcDay(parsedFrom);
  } else if (!hasFrom && hasTo && parsedTo) {
    rangeFrom = startOfUtcDay(parsedTo);
  }

  if (rangeFrom && rangeTo && rangeTo < rangeFrom) {
    return {
      ok: false,
      message: "To date filter must be on or after from date filter.",
    };
  }

  const filter = {};
  if (rangeFrom && rangeTo) {
    filter[fieldName] = { $gte: rangeFrom, $lte: rangeTo };
  } else if (rangeFrom) {
    filter[fieldName] = { $gte: rangeFrom };
  } else if (rangeTo) {
    filter[fieldName] = { $lte: rangeTo };
  }

  return { ok: true, filter };
};

module.exports = {
  buildScheduleDateRangeCore,
  buildQuoteDateRangeFilter,
  buildQuoteTodayOverlapFilter,
  buildOrderDateRangeFilter,
  buildOrderTodayOverlapFilter,
  buildFieldDateRangeFilter,
};

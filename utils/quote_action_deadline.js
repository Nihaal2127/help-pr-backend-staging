const { resolveQuoteStatus } = require("../enum/quote_status_enum");

const DEFAULT_DEADLINE_MINUTES = 60;
const DEADLINE_REMINDER_MINUTES = [20, 10, 5, 2];
const CATCH_WINDOW_MS = 90 * 1000;

const parsePositiveNumber = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const getQuoteActionDeadlineMinutes = () =>
  parsePositiveNumber(
    process.env.QUOTE_ACTION_DEADLINE_MINUTES,
    DEFAULT_DEADLINE_MINUTES
  );

const getQuoteActionDeadlineMs = () =>
  getQuoteActionDeadlineMinutes() * 60 * 1000;

const sameId = (a, b) => String(a || "") === String(b || "");

const refreshQuoteActionDeadline = (quote, now = new Date()) => {
  quote.action_deadline_at = new Date(now.getTime() + getQuoteActionDeadlineMs());
};

const clearQuoteActionDeadline = (quote) => {
  quote.action_deadline_at = null;
};

/**
 * Refresh the 1-hour action window when entering pending/accepted (or
 * reassigning the partner while pending). Clear it on any other status.
 * Unrelated field edits must pass the previous status + partner so the
 * existing deadline is kept.
 */
const applyQuoteActionDeadline = (
  quote,
  { previousStatus = "", previousPartnerId, now = new Date() } = {}
) => {
  const status = resolveQuoteStatus(quote);
  const partnerId = quote?.partner_id || null;
  const prevPartner =
    previousPartnerId === undefined ? partnerId : previousPartnerId;

  if (status === "pending" && partnerId) {
    const enteredPending = previousStatus !== "pending";
    const reassigned = !sameId(prevPartner, partnerId);
    if (enteredPending || reassigned) {
      refreshQuoteActionDeadline(quote, now);
    }
    return;
  }

  if (status === "accepted") {
    if (previousStatus !== "accepted") {
      refreshQuoteActionDeadline(quote, now);
    }
    return;
  }

  clearQuoteActionDeadline(quote);
};

const historyStatusEnteredAt = (quote, status) => {
  const history = Array.isArray(quote?.history) ? quote.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i] || {};
    const changes = Array.isArray(event.changes) ? event.changes : [];
    const hit = changes.find(
      (change) =>
        change?.field === "status" &&
        String(change.new_value || "")
          .trim()
          .toLowerCase() === status
    );
    if (hit && event.at) return event.at;
  }
  return null;
};

/**
 * Infer deadline for quotes created before action_deadline_at existed.
 * Returns null when the 1-hour window has already passed.
 */
const inferQuoteActionDeadlineAt = (quote, now = new Date()) => {
  if (quote?.action_deadline_at) {
    const existing = new Date(quote.action_deadline_at);
    if (!Number.isNaN(existing.getTime()) && existing > now) return existing;
    return null;
  }

  const status = resolveQuoteStatus(quote);
  if (status !== "pending" && status !== "accepted") return null;

  const startedAt =
    historyStatusEnteredAt(quote, status) || quote.created_at || null;
  if (!startedAt) return null;

  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return null;

  const deadline = new Date(started.getTime() + getQuoteActionDeadlineMs());
  if (deadline <= now) return null;
  return deadline;
};

const matchDeadlineReminderBucket = (remainingMs) => {
  for (const minutes of DEADLINE_REMINDER_MINUTES) {
    const upper = minutes * 60 * 1000;
    const lower = upper - CATCH_WINDOW_MS;
    if (remainingMs > lower && remainingMs <= upper) return minutes;
  }
  return null;
};

const deadlineReminderActionHint = (status) =>
  status === "accepted"
    ? "Please convert it to an order."
    : "Please accept or reject it.";

module.exports = {
  DEADLINE_REMINDER_MINUTES,
  CATCH_WINDOW_MS,
  getQuoteActionDeadlineMinutes,
  getQuoteActionDeadlineMs,
  refreshQuoteActionDeadline,
  clearQuoteActionDeadline,
  applyQuoteActionDeadline,
  inferQuoteActionDeadlineAt,
  matchDeadlineReminderBucket,
  deadlineReminderActionHint,
};

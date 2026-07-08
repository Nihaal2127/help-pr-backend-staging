const parsePositiveNumber = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
};

const getReminderConfig = () => ({
  /** Hours before service start to send RM1 (default 24). */
  serviceReminderLeadHours: parsePositiveNumber(
    process.env.SERVICE_REMINDER_LEAD_HOURS,
    24
  ),
  /** Hours a quote must be unchanged before RM2 (default 48). */
  quotePendingStaleHours: parsePositiveNumber(
    process.env.QUOTE_PENDING_REMINDER_HOURS,
    48
  ),
  /** Days before subscription expiry to send RM3 (default 7). */
  subscriptionExpiringDays: parsePositiveNumber(
    process.env.SUBSCRIPTION_EXPIRING_REMINDER_DAYS,
    7
  ),
});

module.exports = {
  getReminderConfig,
};

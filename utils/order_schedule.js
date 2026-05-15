/**
 * Combines a calendar date with an HH:mm time string (local hours).
 */
const combineDateAndTime = (dateValue, timeStr) => {
  if (!dateValue || !timeStr || typeof timeStr !== "string") return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const parts = timeStr.trim().split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  d.setHours(h, m, 0, 0);
  return d;
};

module.exports = { combineDateAndTime };

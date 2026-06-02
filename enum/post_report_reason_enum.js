const REPORT_REASON_SPAM = 'spam';
const REPORT_REASON_INAPPROPRIATE = 'inappropriate';
const REPORT_REASON_MISLEADING = 'misleading';
const REPORT_REASON_OTHER = 'other';

const REPORT_REASONS = [
  REPORT_REASON_SPAM,
  REPORT_REASON_INAPPROPRIATE,
  REPORT_REASON_MISLEADING,
  REPORT_REASON_OTHER,
];

const REPORT_STATUS_PENDING = 'pending';
const REPORT_STATUS_REVIEWED = 'reviewed';
const REPORT_STATUS_DISMISSED = 'dismissed';

const REPORT_STATUSES = [
  REPORT_STATUS_PENDING,
  REPORT_STATUS_REVIEWED,
  REPORT_STATUS_DISMISSED,
];

const POST_STATUS_PUBLISHED = 'published';
const POST_STATUS_HIDDEN = 'hidden';
const POST_STATUS_REMOVED = 'removed';

const POST_STATUSES = [POST_STATUS_PUBLISHED, POST_STATUS_HIDDEN, POST_STATUS_REMOVED];

const normalizeReportReason = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (REPORT_REASONS.includes(s)) return s;
  return null;
};

const normalizeReportStatus = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (REPORT_STATUSES.includes(s)) return s;
  return null;
};

const normalizePostStatus = (raw) => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (POST_STATUSES.includes(s)) return s;
  return null;
};

module.exports = {
  REPORT_REASON_SPAM,
  REPORT_REASON_INAPPROPRIATE,
  REPORT_REASON_MISLEADING,
  REPORT_REASON_OTHER,
  REPORT_REASONS,
  REPORT_STATUS_PENDING,
  REPORT_STATUS_REVIEWED,
  REPORT_STATUS_DISMISSED,
  REPORT_STATUSES,
  POST_STATUS_PUBLISHED,
  POST_STATUS_HIDDEN,
  POST_STATUS_REMOVED,
  POST_STATUSES,
  normalizeReportReason,
  normalizeReportStatus,
  normalizePostStatus,
};

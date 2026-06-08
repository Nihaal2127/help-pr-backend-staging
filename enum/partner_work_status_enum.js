const PARTNER_WORK_STATUS_PENDING = 'pending';
const PARTNER_WORK_STATUS_IN_PROGRESS = 'in-progress';
const PARTNER_WORK_STATUS_COMPLETED = 'completed';

const PARTNER_WORK_STATUSES = [
  PARTNER_WORK_STATUS_PENDING,
  PARTNER_WORK_STATUS_IN_PROGRESS,
  PARTNER_WORK_STATUS_COMPLETED,
];

const DEFAULT_PARTNER_WORK_STATUS = PARTNER_WORK_STATUS_PENDING;

const STATUS_ALIASES = {
  inprogress: PARTNER_WORK_STATUS_IN_PROGRESS,
  'in progress': PARTNER_WORK_STATUS_IN_PROGRESS,
  complete: PARTNER_WORK_STATUS_COMPLETED,
};

const ALLOWED_TRANSITIONS = {
  [PARTNER_WORK_STATUS_PENDING]: [PARTNER_WORK_STATUS_IN_PROGRESS],
  [PARTNER_WORK_STATUS_IN_PROGRESS]: [PARTNER_WORK_STATUS_COMPLETED],
  [PARTNER_WORK_STATUS_COMPLETED]: [],
};

const normalizePartnerWorkStatus = (value) => {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (PARTNER_WORK_STATUSES.includes(raw)) return raw;
  if (STATUS_ALIASES[raw]) return STATUS_ALIASES[raw];
  return null;
};

const isValidPartnerWorkStatus = (value) => normalizePartnerWorkStatus(value) !== null;

const canTransitionPartnerWorkStatus = (from, to) => {
  const fromNorm = normalizePartnerWorkStatus(from);
  const toNorm = normalizePartnerWorkStatus(to);
  if (!fromNorm || !toNorm) return false;
  return (ALLOWED_TRANSITIONS[fromNorm] || []).includes(toNorm);
};

const buildPartnerWorkStatusInfo = () =>
  PARTNER_WORK_STATUSES.map((status) => ({
    status,
    updated_at: status === DEFAULT_PARTNER_WORK_STATUS ? new Date() : null,
    updated_by_id: null,
    actor_role: '',
  }));

const touchPartnerWorkStatusInfo = (
  order,
  status,
  actorId = null,
  actorRole = 'partner'
) => {
  const normalized = normalizePartnerWorkStatus(status);
  if (!normalized) return;

  if (!Array.isArray(order.partner_work_status_info)) {
    order.partner_work_status_info = [];
  }

  const entry = order.partner_work_status_info.find((row) => row.status === normalized);
  const now = new Date();
  const actorOid =
    actorId && String(actorId).trim() !== '' ? actorId : null;

  if (entry) {
    entry.updated_at = now;
    entry.updated_by_id = actorOid;
    entry.actor_role = actorRole || 'partner';
  } else {
    order.partner_work_status_info.push({
      status: normalized,
      updated_at: now,
      updated_by_id: actorOid,
      actor_role: actorRole || 'partner',
    });
  }
};

const buildPartnerWorkStatusQueryFilter = (value) => {
  const normalized = normalizePartnerWorkStatus(value);
  if (!normalized) return null;
  return { partner_work_status: normalized };
};

module.exports = {
  PARTNER_WORK_STATUS_PENDING,
  PARTNER_WORK_STATUS_IN_PROGRESS,
  PARTNER_WORK_STATUS_COMPLETED,
  PARTNER_WORK_STATUSES,
  DEFAULT_PARTNER_WORK_STATUS,
  normalizePartnerWorkStatus,
  isValidPartnerWorkStatus,
  canTransitionPartnerWorkStatus,
  buildPartnerWorkStatusInfo,
  touchPartnerWorkStatusInfo,
  buildPartnerWorkStatusQueryFilter,
};

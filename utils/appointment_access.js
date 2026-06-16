const {
  buildFranchiseOrderListFilter,
  fetchFranchiseMemberUserIds,
  assertOrderRecordAccess,
} = require("./order_access");
const { resolveFranchiseListScope, assertFranchiseRecordAccess } = require("./franchise_scope_access");

const resolveAppointmentListScope = async (req, { franchiseIdFromQuery } = {}) =>
  resolveFranchiseListScope(req, {
    franchiseIdFromQuery,
    entityLabel: "appointments",
    buildAdminFranchiseFilter: async (franchiseOid) => {
      const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
      return buildFranchiseOrderListFilter(franchiseOid, memberUserIds);
    },
  });

const assertAppointmentRecordAccess = async (req, appointment) =>
  assertFranchiseRecordAccess(req, appointment, {
    entityLabel: "this appointment",
    legacyMatchFn: async (record, franchiseOid) => {
      const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
      if (!memberUserIds.length) return false;
      const memberSet = new Set(memberUserIds.map((id) => String(id)));
      const ids = [record.partner_id, record.employee_id, record.created_by_id]
        .filter((x) => x != null)
        .map((x) => String(x._id ?? x));
      return ids.some((id) => memberSet.has(id));
    },
  });

module.exports = {
  resolveAppointmentListScope,
  assertAppointmentRecordAccess,
  assertOrderRecordAccess,
};

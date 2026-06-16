const mongoose = require("mongoose");
const {
  buildFranchiseOrderListFilter,
  fetchFranchiseMemberUserIds,
  assertOrderRecordAccess,
} = require("./order_access");
const { resolveFranchiseListScope, assertFranchiseRecordAccess } = require("./franchise_scope_access");

const toIdString = (value) => {
  if (value == null) return "";
  return String(value._id ?? value);
};

const resolvePartnerObjectId = (partnerId) => {
  if (!partnerId || !mongoose.Types.ObjectId.isValid(String(partnerId))) {
    return { ok: false, status: 401, message: "Invalid token." };
  }
  return { ok: true, oid: new mongoose.Types.ObjectId(String(partnerId)) };
};

const assertPartnerOrderAccess = (partnerId, order) => {
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  const partnerOid = resolvePartnerObjectId(partnerId);
  if (!partnerOid.ok) return partnerOid;

  const orderPartnerId = toIdString(order.partner_id);
  if (!orderPartnerId || orderPartnerId !== String(partnerOid.oid)) {
    return {
      ok: false,
      status: 403,
      message: "You are not allowed to manage appointments for this order.",
    };
  }
  return { ok: true };
};

const assertPartnerAppointmentAccess = (partnerId, appointment) => {
  if (!appointment) {
    return { ok: false, status: 404, message: "Appointment not found." };
  }
  const partnerOid = resolvePartnerObjectId(partnerId);
  if (!partnerOid.ok) return partnerOid;

  const appointmentPartnerId = toIdString(appointment.partner_id);
  if (!appointmentPartnerId || appointmentPartnerId !== String(partnerOid.oid)) {
    return {
      ok: false,
      status: 403,
      message: "You are not allowed to access this appointment.",
    };
  }
  return { ok: true };
};

const assertOrderAccessForAppointment = async (req, order, { partnerId } = {}) => {
  if (partnerId) {
    return assertPartnerOrderAccess(partnerId, order);
  }
  return assertOrderRecordAccess(req, order);
};

const assertAppointmentAccessForMutation = async (req, appointment, { partnerId } = {}) => {
  if (partnerId) {
    return assertPartnerAppointmentAccess(partnerId, appointment);
  }
  return assertFranchiseRecordAccess(req, appointment, {
    entityLabel: "this appointment",
    legacyMatchFn: async (record, franchiseOid) => {
      const memberUserIds = await fetchFranchiseMemberUserIds(franchiseOid);
      if (!memberUserIds.length) return false;
      const memberSet = new Set(memberUserIds.map((id) => String(id)));
      const ids = [record.partner_id, record.employee_id, record.created_by_id]
        .filter((x) => x != null)
        .map((x) => toIdString(x));
      return ids.some((id) => memberSet.has(id));
    },
  });
};

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
  assertAppointmentAccessForMutation(req, appointment);

const buildPartnerAppointmentListFilter = (partnerId) => {
  const partnerOid = resolvePartnerObjectId(partnerId);
  if (!partnerOid.ok) return partnerOid;
  return { ok: true, filter: { partner_id: partnerOid.oid } };
};

module.exports = {
  resolveAppointmentListScope,
  assertAppointmentRecordAccess,
  assertOrderRecordAccess,
  assertOrderAccessForAppointment,
  assertAppointmentAccessForMutation,
  assertPartnerOrderAccess,
  assertPartnerAppointmentAccess,
  buildPartnerAppointmentListFilter,
  resolvePartnerObjectId,
};

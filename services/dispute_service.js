const mongoose = require("mongoose");
const Dispute = require("../models/dispute");
const Order = require("../models/order");
const { getDisputeId } = require("../helper/id_generator");
const { ORDER_STATUS_COMPLETED } = require("../enum/order_status_enum");
const {
  DISPUTE_STATUS_OPEN,
  DISPUTE_STATUS_IN_REVIEW,
  DISPUTE_STATUS_RESOLVED,
  DISPUTE_STATUS_CLOSED,
  DISPUTE_STATUSES,
  OPEN_DISPUTE_STATUSES,
} = require("../enum/dispute_status_enum");
const {
  USER_TYPE_CUSTOMER,
  USER_TYPE_EMPLOYEE,
} = require("../constants/user_types");
const {
  provisionDisputeChatForRecord,
  applyDisputeStatusChatEffects,
} = require("./chat_integration");
const { safeNotifyDisputeRaised } = require("../src/modules/notifications/services/domainHooks");
const { applyPagination } = require("../utils/pagination");
const { resolveFranchiseListScope, assertFranchiseRecordAccess } = require("../utils/franchise_scope_access");
const { loadCaller } = require("../utils/auth_caller");

const fail = (status, message) => ({ ok: false, status, message });
const ok = (status, data = {}) => ({ ok: true, status, ...data });

const formatDisputeForApi = (dispute) => {
  if (!dispute) return dispute;
  return dispute.toObject ? dispute.toObject() : { ...dispute };
};

const findOpenDisputeForOrder = async (orderId) =>
  Dispute.findOne({
    order_id: orderId,
    status: { $in: OPEN_DISPUTE_STATUSES },
    deleted_at: null,
  });

const assertDisputeAccess = async (req, dispute) => {
  const callerResult = await loadCaller(req);
  if (!callerResult.ok) {
    return fail(callerResult.status, callerResult.message);
  }

  const { caller, callerId } = callerResult;
  const callerType = Number(caller.type);
  const callerStr = String(callerId);

  if (callerType === USER_TYPE_CUSTOMER) {
    if (String(dispute.user_id) !== callerStr) {
      return fail(403, "You do not have access to this dispute.");
    }
    return ok(200, { caller, callerId });
  }

  if (
    callerType === USER_TYPE_EMPLOYEE &&
    String(dispute.employee_id) === callerStr
  ) {
    return ok(200, { caller, callerId });
  }

  const franchiseCheck = await assertFranchiseRecordAccess(req, dispute, {
    entityLabel: "this dispute",
  });
  if (!franchiseCheck.ok) {
    return fail(franchiseCheck.status, franchiseCheck.message);
  }

  return ok(200, { caller, callerId });
};

const raiseDisputeForCustomer = async (customerId, body) => {
  const { order_id: orderId, reason, description } = body;

  if (!mongoose.Types.ObjectId.isValid(String(orderId))) {
    return fail(400, "Valid order_id is required.");
  }

  const order = await Order.findOne({
    _id: orderId,
    user_id: customerId,
    deleted_at: null,
  }).lean();

  if (!order) {
    return fail(404, "Order not found.");
  }

  if (order.order_status !== ORDER_STATUS_COMPLETED) {
    return fail(409, "Disputes can only be raised for completed orders.");
  }

  if (!order.employee_id) {
    return fail(409, "This order has no assigned employee for dispute chat.");
  }

  const existing = await findOpenDisputeForOrder(order._id);
  if (existing) {
    return {
      ok: false,
      status: 409,
      message: "An open dispute already exists for this order.",
      record: formatDisputeForApi(existing),
    };
  }

  const unique_id = await getDisputeId();
  let dispute;

  try {
    dispute = await Dispute.create({
      unique_id,
      order_id: order._id,
      user_id: order.user_id,
      employee_id: order.employee_id,
      franchise_id: order.franchise_id || null,
      reason: reason ? String(reason).trim() : "",
      description: description ? String(description).trim() : "",
      status: DISPUTE_STATUS_OPEN,
      created_at: new Date(),
      updated_at: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await findOpenDisputeForOrder(order._id);
      return {
        ok: false,
        status: 409,
        message: "An open dispute already exists for this order.",
        record: duplicate ? formatDisputeForApi(duplicate) : undefined,
      };
    }
    throw error;
  }

  const chatResult = await provisionDisputeChatForRecord({
    dispute,
    reason,
    description,
  });

  if (!chatResult.ok) {
    await Dispute.deleteOne({ _id: dispute._id });
    return fail(500, chatResult.message || "Failed to create dispute chat. Please try again.");
  }

  const chat = chatResult.chat;
  dispute.chat_id = chat._id;
  await dispute.save();

  void safeNotifyDisputeRaised({
    dispute,
    order,
    actorUserId: customerId,
  });

  return ok(201, {
    message: "Dispute raised successfully.",
    record: formatDisputeForApi(dispute),
  });
};

const listCustomerDisputes = async (customerId, query = {}) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;

  const filter = {
    user_id: new mongoose.Types.ObjectId(String(customerId)),
    deleted_at: null,
  };

  const { data, totalCount, totalPages, currentPage } = await applyPagination(
    Dispute,
    filter,
    page,
    limit,
    { created_at: -1 }
  );

  return ok(200, {
    message: "Disputes fetched successfully.",
    records: data.map(formatDisputeForApi),
    totalItems: totalCount,
    totalPages,
    currentPage,
  });
};

const listDisputesForBackOffice = async (req, query = {}) => {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 10;

  const scope = await resolveFranchiseListScope(req, {
    franchiseIdFromQuery: query.franchise_id,
    entityLabel: "disputes",
  });

  if (!scope.ok) {
    return fail(scope.status, scope.message);
  }

  if (scope.noFranchise) {
    return ok(200, {
      message: "Disputes fetched successfully.",
      records: [],
      totalItems: 0,
      totalPages: 0,
      currentPage: page,
    });
  }

  const filter = {
    deleted_at: null,
    ...scope.filter,
  };

  if (query.status && DISPUTE_STATUSES.includes(String(query.status))) {
    filter.status = String(query.status);
  }

  if (query.order_id && mongoose.Types.ObjectId.isValid(String(query.order_id))) {
    filter.order_id = new mongoose.Types.ObjectId(String(query.order_id));
  }

  const { data, totalCount, totalPages, currentPage } = await applyPagination(
    Dispute,
    filter,
    page,
    limit,
    { created_at: -1 }
  );

  return ok(200, {
    message: "Disputes fetched successfully.",
    records: data.map(formatDisputeForApi),
    totalItems: totalCount,
    totalPages,
    currentPage,
  });
};

const getDisputeById = async (req, disputeId) => {
  if (!mongoose.Types.ObjectId.isValid(String(disputeId))) {
    return fail(400, "Invalid dispute id.");
  }

  const dispute = await Dispute.findOne({
    _id: disputeId,
    deleted_at: null,
  });

  if (!dispute) {
    return fail(404, "Dispute not found.");
  }

  const access = await assertDisputeAccess(req, dispute);
  if (!access.ok) {
    return access;
  }

  return ok(200, {
    message: "Dispute fetched successfully.",
    record: formatDisputeForApi(dispute),
  });
};

const updateDisputeStatus = async (req, disputeId, body) => {
  if (!mongoose.Types.ObjectId.isValid(String(disputeId))) {
    return fail(400, "Invalid dispute id.");
  }

  const dispute = await Dispute.findOne({
    _id: disputeId,
    deleted_at: null,
  });

  if (!dispute) {
    return fail(404, "Dispute not found.");
  }

  const access = await assertDisputeAccess(req, dispute);
  if (!access.ok) {
    return access;
  }

  const callerType = Number(access.caller.type);
  if (callerType === USER_TYPE_CUSTOMER) {
    return fail(403, "Customers cannot update dispute status.");
  }

  const nextStatus = body.status ? String(body.status).trim() : null;
  if (!nextStatus || !DISPUTE_STATUSES.includes(nextStatus)) {
    return fail(400, `Invalid status. Use one of: ${DISPUTE_STATUSES.join(", ")}.`);
  }

  dispute.status = nextStatus;
  dispute.updated_at = new Date();

  if ([DISPUTE_STATUS_RESOLVED, DISPUTE_STATUS_CLOSED].includes(nextStatus)) {
    dispute.resolved_at = new Date();
    dispute.resolved_by_id = access.callerId;
  }

  await applyDisputeStatusChatEffects({ dispute, nextStatus });

  await dispute.save();

  return ok(200, {
    message: "Dispute updated successfully.",
    record: formatDisputeForApi(dispute),
  });
};

module.exports = {
  raiseDisputeForCustomer,
  listCustomerDisputes,
  listDisputesForBackOffice,
  getDisputeById,
  updateDisputeStatus,
};

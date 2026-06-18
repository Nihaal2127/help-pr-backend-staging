const {
  raiseDisputeForCustomer,
  listCustomerDisputes,
  getDisputeById,
} = require("../../../services/dispute_service");
const { createOrGetSupportChat } = require("../../../src/modules/chat/services/chatProvisioning.service");
const { fail, ok } = require("../../../utils/mobile_service_result");

const raiseDispute = async (customerId, body) => {
  try {
    const result = await raiseDisputeForCustomer(customerId, body);
    if (!result.ok) {
      return fail(result.status, result.message, result.record ? { record: result.record } : {});
    }
    return ok(result.status, {
      message: result.message,
      record: result.record,
    });
  } catch (error) {
    console.error("raiseDispute:", error.message);
    return fail(500, "Internal server error.");
  }
};

const listDisputes = async (customerId, query) => {
  try {
    const result = await listCustomerDisputes(customerId, query);
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(result.status, {
      message: result.message,
      data: {
        message: result.message,
        records: result.records,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
        currentPage: result.currentPage,
        limit: parseInt(query.limit, 10) || 10,
      },
    });
  } catch (error) {
    console.error("listDisputes:", error.message);
    return fail(500, "Internal server error.");
  }
};

const getDispute = async (req, disputeId) => {
  try {
    const result = await getDisputeById(req, disputeId);
    if (!result.ok) {
      return fail(result.status, result.message);
    }
    return ok(result.status, {
      message: result.message,
      record: result.record,
    });
  } catch (error) {
    console.error("getDispute:", error.message);
    return fail(500, "Internal server error.");
  }
};

const startSupportChat = async (customerId, body, userType) => {
  try {
    const result = await createOrGetSupportChat({
      customerId,
      employeeId: body.employee_id,
      franchiseId: body.franchise_id,
      initialMessage: body.initial_message,
      actorUserId: customerId,
      userType,
    });

    if (!result.ok) {
      return fail(result.status, result.message);
    }

    return ok(result.created ? 201 : 200, {
      message: result.created ? "Support chat created." : "Support chat fetched.",
      record: result.chat,
    });
  } catch (error) {
    console.error("startSupportChat:", error.message);
    return fail(500, "Internal server error.");
  }
};

module.exports = {
  raiseDispute,
  listDisputes,
  getDispute,
  startSupportChat,
};

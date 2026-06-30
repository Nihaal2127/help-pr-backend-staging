const {
  raiseDisputeForCustomer,
  listCustomerDisputes,
  getDisputeById,
} = require("../../../services/dispute_service");
const { proxyMobileSupportChat, isChatServiceEnabled } = require("../../../services/chat_service_client");
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

const startSupportChat = async (authorizationHeader, body) => {
  try {
    if (!isChatServiceEnabled()) {
      return fail(503, "Chat service is not configured.");
    }

    const result = await proxyMobileSupportChat(authorizationHeader, body);
    if (!result.ok) {
      return fail(result.status, result.message);
    }

    const payload = result.data || {};
    return ok(result.status, {
      message: payload.message,
      record: payload.record,
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

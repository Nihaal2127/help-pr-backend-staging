const {
  raiseDispute,
  listDisputes,
  getDispute,
  startSupportChat,
} = require("../../../services/mobile/user/chat_dispute_service");
const {
  getCallerId,
  wrapMobileHandler,
  sendPaginatedListFromData,
  sendRecordResult,
  sendServiceError,
} = require("../../../utils/mobile_controller_helpers");

const raiseDisputeHandler = wrapMobileHandler("mobile user raise dispute handler", async (req, res) => {
  const result = await raiseDispute(getCallerId(req), req.body);
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
      ...(result.record ? { record: result.record } : {}),
    });
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    message: result.data.message,
    record: result.data.record,
  });
});

const listDisputesHandler = wrapMobileHandler("mobile user list disputes handler", async (req, res) => {
  const result = await listDisputes(getCallerId(req), req.query);
  return sendPaginatedListFromData(res, result);
});

const getDisputeHandler = wrapMobileHandler("mobile user get dispute handler", async (req, res) => {
  const result = await getDispute(req, req.params.disputeId);
  return sendRecordResult(res, result);
});

const startSupportChatHandler = wrapMobileHandler("mobile user start support chat handler", async (req, res) => {
  const result = await startSupportChat(req.header("Authorization"), req.body);
  if (!result.ok) {
    return sendServiceError(res, result);
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    message: result.data.message,
    record: result.data.record,
  });
});

module.exports = {
  raiseDisputeHandler,
  listDisputesHandler,
  getDisputeHandler,
  startSupportChatHandler,
};

const subscriptionChangeService = require('../../../services/mobile/partner/subscription_change_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceResult,
} = require('../../../utils/mobile_controller_helpers');

const getSummary = wrapMobileHandler('mobile partner subscription summary', async (req, res) => {
  const result = await subscriptionChangeService.getSubscriptionSummary(getCallerId(req));
  return sendServiceResult(res, result);
});

const previewChange = wrapMobileHandler('mobile partner subscription preview', async (req, res) => {
  const result = await subscriptionChangeService.previewChange(
    getCallerId(req),
    req.body.target_plan_id
  );
  return sendServiceResult(res, result);
});

const applyChange = wrapMobileHandler('mobile partner subscription change', async (req, res) => {
  const result = await subscriptionChangeService.applyChange(getCallerId(req), req.body);
  return sendServiceResult(res, result);
});

const getChangePaymentStatus = wrapMobileHandler(
  'mobile partner subscription change payment status',
  async (req, res) => {
    const result = await subscriptionChangeService.getChangePaymentStatus(
      getCallerId(req),
      req.params.changeId
    );
    return sendServiceResult(res, result);
  }
);

const listHistory = wrapMobileHandler('mobile partner subscription history', async (req, res) => {
  const result = await subscriptionChangeService.listChangeHistory(getCallerId(req), req.query);
  return sendServiceResult(res, result);
});

module.exports = {
  getSummary,
  previewChange,
  applyChange,
  listHistory,
  getChangePaymentStatus,
};

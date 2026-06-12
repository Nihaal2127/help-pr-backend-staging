const subscriptionPlanService = require('../../../services/subscription_plan_service');
const {
  wrapMobileHandler,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const list = wrapMobileHandler('mobile partner subscription plans list', async (req, res) => {
  const result = await subscriptionPlanService.listSubscriptionPlansForDropdown({});
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  const { records, ...rest } = result.data;
  return res.status(result.status).json({
    success: true,
    status: result.status,
    ...rest,
    data: records,
  });
});

module.exports = {
  list,
};

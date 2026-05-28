const subscriptionPlanService = require('../../../services/subscription_plan_service');

const sendServiceResult = (res, result) => {
  if (!result.ok) {
    return res.status(result.status).json({
      success: false,
      status: result.status,
      message: result.message,
    });
  }
  return res.status(result.status).json({
    success: true,
    status: result.status,
    ...result.data,
  });
};

const list = async (req, res) => {
  try {
    const result = await subscriptionPlanService.listSubscriptionPlansForDropdown({});
    if (!result.ok) {
      return sendServiceResult(res, result);
    }
    const { records, ...rest } = result.data;
    return res.status(result.status).json({
      success: true,
      status: result.status,
      ...rest,
      data: records,
    });
  } catch (err) {
    console.error('mobile partner subscription plans list', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  list,
};

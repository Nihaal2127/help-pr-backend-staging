const { getPartnerHome } = require('../../../services/mobile/partner/home_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const getHomeHandler = wrapMobileHandler('mobile partner home handler', async (req, res) => {
  const result = await getPartnerHome(getCallerId(req));

  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    message: result.data.message,
    data: result.data.data,
  });
});

module.exports = {
  getHomeHandler,
};

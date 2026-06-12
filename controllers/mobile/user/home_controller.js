const { getHomeForLocation } = require('../../../services/mobile/user/home_service');
const { wrapMobileHandler, sendServiceError } = require('../../../utils/mobile_controller_helpers');

const getHomeHandler = wrapMobileHandler('mobile user home', async (req, res) => {
  const result = await getHomeForLocation({
    location: req.query.location,
    userId: req.user?.id,
  });

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

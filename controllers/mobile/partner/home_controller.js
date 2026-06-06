const { getPartnerHome } = require('../../../services/mobile/partner/home_service');

const getCallerId = (req) => req.user?.id || req.user?._id;

const getHomeHandler = async (req, res) => {
  try {
    const result = await getPartnerHome(getCallerId(req));

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: result.data.message,
      data: result.data.data,
    });
  } catch (error) {
    console.error('mobile partner home handler', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  getHomeHandler,
};

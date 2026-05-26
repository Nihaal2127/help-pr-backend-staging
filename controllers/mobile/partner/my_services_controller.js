const {
  listPartnerMyServices,
  updatePartnerMyServices,
} = require('../../../services/mobile/partner/my_services_service');

const list = async (req, res) => {
  try {
    const result = await listPartnerMyServices(req.user.id);
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
      ...result.data,
    });
  } catch (err) {
    console.error('mobile partner my-services', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const update = async (req, res) => {
  try {
    const result = await updatePartnerMyServices(req.user.id, req.body.services);
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
      ...result.data,
      message: 'Partner services updated successfully.',
    });
  } catch (err) {
    console.error('mobile partner my-services update', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  list,
  update,
};

const { listFranchiseCategoriesForPartner } = require('../../../services/mobile/partner/catalog_service');

const categories = async (req, res) => {
  try {
    const result = await listFranchiseCategoriesForPartner(req.user.id);
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
    console.error('mobile partner catalog categories', err.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  categories,
};

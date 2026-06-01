const { listFranchisePartnersPaginated } = require('../../../services/mobile/user/partners_service');

const listPartnersHandler = async (req, res) => {
  try {
    const result = await listFranchisePartnersPaginated(req.query);

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
      totalItems: result.data.data.totalItems,
      totalPages: result.data.data.totalPages,
      currentPage: result.data.data.currentPage,
      limit: result.data.data.limit,
      data: {
        franchise_id: result.data.data.franchise_id,
        franchise_name: result.data.data.franchise_name,
        partners: result.data.data.partners,
      },
    });
  } catch (error) {
    console.error('mobile user partners list', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listPartnersHandler,
};

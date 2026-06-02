const {
  listFranchisePartnersPaginated,
  getPartnerProfileForCustomer,
} = require('../../../services/mobile/user/partners_service');
const { getPartnerRatingsSummary } = require('../../../services/mobile/user/partner_rating_service');
const {
  savePartnerForCustomer,
  unsavePartnerForCustomer,
  listSavedPartnersPaginated,
} = require('../../../services/mobile/user/saved_partners_service');

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

const listSavedPartnersHandler = async (req, res) => {
  try {
    const result = await listSavedPartnersPaginated(req.user.id, req.query);

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
        partners: result.data.data.partners,
      },
    });
  } catch (error) {
    console.error('mobile user saved partners list', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const savePartnerHandler = async (req, res) => {
  try {
    const result = await savePartnerForCustomer(req.user.id, req.params.partnerId);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    const httpStatus = result.data.message === 'Partner saved successfully.' ? 201 : 200;

    return res.status(httpStatus).json({
      success: true,
      status: httpStatus,
      message: result.data.message,
      data: result.data.data,
    });
  } catch (error) {
    console.error('mobile user save partner', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const unsavePartnerHandler = async (req, res) => {
  try {
    const result = await unsavePartnerForCustomer(req.user.id, req.params.partnerId);

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
    console.error('mobile user unsave partner', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPartnerRatingsHandler = async (req, res) => {
  try {
    const result = await getPartnerRatingsSummary(req.params.partnerId, req.query);

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
    console.error('mobile user partner ratings', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPartnerProfileHandler = async (req, res) => {
  try {
    const result = await getPartnerProfileForCustomer(
      req.params.partnerId,
      req.query.franchise_id,
      req.user.id
    );

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
    console.error('mobile user partner profile', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  listPartnersHandler,
  listSavedPartnersHandler,
  savePartnerHandler,
  unsavePartnerHandler,
  getPartnerRatingsHandler,
  getPartnerProfileHandler,
};

const {
  resolvePartnersListScope,
  assertPartnersRecordAccess,
} = require('../utils/partners_access');
const {
  listPartnersForAdmin,
  getPartnersBrowseCounts,
  loadPartnerForAccess,
  getPartnerProfileForAdmin,
} = require('../services/partners_admin_service');
const { getPartnerOrderRatingsForAdmin } = require('../services/partner_ratings_admin_service');

const sendScopeError = (res, scopeResult) =>
  res.status(scopeResult.status).json({
    success: false,
    status: scopeResult.status,
    message: scopeResult.message,
  });

const getPartnersCountsHandler = async (req, res) => {
  try {
    const scopeResult = await resolvePartnersListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return sendScopeError(res, scopeResult);
    }

    const result = await getPartnersBrowseCounts(scopeResult, req.query);
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
      record: result.data.counts,
    });
  } catch (error) {
    console.error('admin partners getCounts', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const listPartnersHandler = async (req, res) => {
  try {
    const scopeResult = await resolvePartnersListScope(req, {
      franchiseIdFromQuery: req.query.franchise_id,
    });
    if (!scopeResult.ok) {
      return sendScopeError(res, scopeResult);
    }

    const result = await listPartnersForAdmin(scopeResult, req.query);
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
    console.error('admin partners list', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPartnerProfileHandler = async (req, res) => {
  try {
    const partnerLoad = await loadPartnerForAccess(req.params.partnerId);
    if (!partnerLoad.ok) {
      return res.status(partnerLoad.status).json({
        success: false,
        status: partnerLoad.status,
        message: partnerLoad.message,
      });
    }

    const access = await assertPartnersRecordAccess(req, partnerLoad.partner);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const result = await getPartnerProfileForAdmin(
      req.params.partnerId,
      req.query.franchise_id
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
    console.error('admin partner profile', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

const getPartnerRatingsHandler = async (req, res) => {
  try {
    const partnerLoad = await loadPartnerForAccess(req.params.partnerId);
    if (!partnerLoad.ok) {
      return res.status(partnerLoad.status).json({
        success: false,
        status: partnerLoad.status,
        message: partnerLoad.message,
      });
    }

    const access = await assertPartnersRecordAccess(req, partnerLoad.partner);
    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        status: access.status,
        message: access.message,
      });
    }

    const result = await getPartnerOrderRatingsForAdmin(req.params.partnerId, req.query);
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
      totalItems: result.data.totalItems,
      totalPages: result.data.totalPages,
      currentPage: result.data.currentPage,
      limit: result.data.limit,
      record: result.data.record,
      records: result.data.records,
    });
  } catch (error) {
    console.error('admin partner ratings', error.message);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error.',
    });
  }
};

module.exports = {
  getPartnersCountsHandler,
  listPartnersHandler,
  getPartnerProfileHandler,
  getPartnerRatingsHandler,
};

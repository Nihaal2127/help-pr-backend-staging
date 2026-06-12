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
const {
  wrapMobileHandler,
  sendPaginatedListWithNestedData,
  sendCreatedOrOkDataResult,
  sendDataResult,
} = require('../../../utils/mobile_controller_helpers');

const listPartnersHandler = wrapMobileHandler('mobile user partners list', async (req, res) => {
  const result = await listFranchisePartnersPaginated(req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    franchise_id: listData.franchise_id,
    franchise_name: listData.franchise_name,
    partners: listData.partners,
  }));
});

const listSavedPartnersHandler = wrapMobileHandler('mobile user saved partners list', async (req, res) => {
  const result = await listSavedPartnersPaginated(req.user.id, req.query);
  return sendPaginatedListWithNestedData(res, result, (listData) => ({
    partners: listData.partners,
  }));
});

const savePartnerHandler = wrapMobileHandler('mobile user save partner', async (req, res) => {
  const result = await savePartnerForCustomer(req.user.id, req.params.partnerId);
  return sendCreatedOrOkDataResult(res, result, 'Partner saved successfully.');
});

const unsavePartnerHandler = wrapMobileHandler('mobile user unsave partner', async (req, res) => {
  const result = await unsavePartnerForCustomer(req.user.id, req.params.partnerId);
  return sendDataResult(res, result);
});

const getPartnerRatingsHandler = wrapMobileHandler('mobile user partner ratings', async (req, res) => {
  const result = await getPartnerRatingsSummary(req.params.partnerId, req.query);
  return sendDataResult(res, result);
});

const getPartnerProfileHandler = wrapMobileHandler('mobile user partner profile', async (req, res) => {
  const result = await getPartnerProfileForCustomer(
    req.params.partnerId,
    req.query.franchise_id,
    req.user.id
  );
  return sendDataResult(res, result);
});

module.exports = {
  listPartnersHandler,
  listSavedPartnersHandler,
  savePartnerHandler,
  unsavePartnerHandler,
  getPartnerRatingsHandler,
  getPartnerProfileHandler,
};

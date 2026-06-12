const { listFranchiseCategoriesForPartner } = require('../../../services/mobile/partner/catalog_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendSpreadDataResult,
} = require('../../../utils/mobile_controller_helpers');

const categories = wrapMobileHandler('mobile partner catalog categories', async (req, res) => {
  const result = await listFranchiseCategoriesForPartner(getCallerId(req));
  return sendSpreadDataResult(res, result);
});

module.exports = {
  categories,
};

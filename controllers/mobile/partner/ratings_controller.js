const { listOwnServiceRatings } = require('../../../services/mobile/partner/partner_rating_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendServiceResult,
} = require('../../../utils/mobile_controller_helpers');

const listOwnServiceRatingsHandler = wrapMobileHandler(
  'mobile partner service ratings',
  async (req, res) => {
    const result = await listOwnServiceRatings(getCallerId(req), req.query);
    return sendServiceResult(res, result);
  }
);

module.exports = {
  listOwnServiceRatingsHandler,
};

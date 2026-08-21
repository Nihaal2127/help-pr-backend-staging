const { assertActivePartner } = require('../shared/partner_access_helpers');
const { listPartnerServiceOrderRatings } = require('../shared/partner_service_ratings_list');
const { fail } = require('../../../utils/mobile_service_result');

const listOwnServiceRatings = async (partnerId, query = {}) => {
  try {
    const partnerResult = await assertActivePartner(partnerId, {
      select: 'name average_rating rating_count',
    });
    if (!partnerResult.ok) return partnerResult;

    return listPartnerServiceOrderRatings({
      partner: partnerResult.data.partner,
      query,
      includeCustomerContact: true,
    });
  } catch (err) {
    console.error('mobile partner list service ratings', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listOwnServiceRatings,
};

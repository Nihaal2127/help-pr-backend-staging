const { resolveListSearchRegex } = require('../../../utils/list_query_helpers');
const {
  listPartnerFinancialOrderPayments,
  getPartnerFinancialOrderPaymentById,
} = require('../../order_financial_payments_service');
const { assertActivePartner } = require('../shared/partner_access_helpers');
const { fail } = require('../../../utils/mobile_service_result');

const listFinancialPayments = async (partnerId, query = {}) => {
  try {
    const partnerResult = await assertActivePartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    const searchRegex = resolveListSearchRegex({ query: query || {} });
    return listPartnerFinancialOrderPayments(
      partnerResult.data.partnerOid,
      query,
      searchRegex
    );
  } catch (err) {
    console.error('listFinancialPayments', err.message);
    return fail(500, 'Internal server error.');
  }
};

const getFinancialPaymentById = async (partnerId, orderId) => {
  try {
    const partnerResult = await assertActivePartner(partnerId);
    if (!partnerResult.ok) {
      return partnerResult;
    }

    return getPartnerFinancialOrderPaymentById(partnerResult.data.partnerOid, orderId);
  } catch (err) {
    console.error('getFinancialPaymentById', err.message);
    return fail(500, 'Internal server error.');
  }
};

module.exports = {
  listFinancialPayments,
  getFinancialPaymentById,
};

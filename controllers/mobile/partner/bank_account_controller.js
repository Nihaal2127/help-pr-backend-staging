const { listPartnerBankAccounts } = require('../../../services/mobile/partner/bank_account_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendDataResult,
} = require('../../../utils/mobile_controller_helpers');

const listHandler = wrapMobileHandler('mobile partner bank accounts list', async (req, res) => {
  const result = await listPartnerBankAccounts(getCallerId(req), { search: req.query.search });
  return sendDataResult(res, result);
});

module.exports = {
  listHandler,
};

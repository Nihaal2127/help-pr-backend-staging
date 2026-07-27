const {
  listPartnerBankAccounts,
  createPartnerBankAccount,
  updatePartnerBankAccount,
  setPartnerBankAccountPrimary,
  deletePartnerBankAccount,
} = require('../../../services/mobile/partner/bank_account_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendDataResult,
  sendRecordResult,
  sendServiceResult,
} = require('../../../utils/mobile_controller_helpers');

const listHandler = wrapMobileHandler('mobile partner bank accounts list', async (req, res) => {
  const result = await listPartnerBankAccounts(getCallerId(req), { search: req.query.search });
  return sendDataResult(res, result);
});

const createHandler = wrapMobileHandler('mobile partner bank accounts create', async (req, res) => {
  const result = await createPartnerBankAccount(getCallerId(req), req.body);
  return sendRecordResult(res, result);
});

const updateHandler = wrapMobileHandler('mobile partner bank accounts update', async (req, res) => {
  const result = await updatePartnerBankAccount(getCallerId(req), req.params.id, req.body);
  return sendRecordResult(res, result);
});

const setPrimaryHandler = wrapMobileHandler(
  'mobile partner bank accounts set primary',
  async (req, res) => {
    const result = await setPartnerBankAccountPrimary(getCallerId(req), req.params.id);
    return sendRecordResult(res, result);
  }
);

const deleteHandler = wrapMobileHandler('mobile partner bank accounts delete', async (req, res) => {
  const result = await deletePartnerBankAccount(getCallerId(req), req.params.id);
  return sendServiceResult(res, result);
});

module.exports = {
  listHandler,
  createHandler,
  updateHandler,
  setPrimaryHandler,
  deleteHandler,
};

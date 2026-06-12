const {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
} = require('../../../services/mobile/user/address_service');
const {
  wrapMobileHandler,
  sendDataResult,
} = require('../../../utils/mobile_controller_helpers');

const listHandler = wrapMobileHandler('mobile user addresses list', async (req, res) => {
  const result = await listAddresses(req.user.id, { search: req.query.search });
  return sendDataResult(res, result);
});

const createHandler = wrapMobileHandler('mobile user address create', async (req, res) => {
  const result = await createAddress(req.user.id, req.body);
  return sendDataResult(res, result);
});

const updateHandler = wrapMobileHandler('mobile user address update', async (req, res) => {
  const result = await updateAddress(req.user.id, req.params.id, req.body);
  return sendDataResult(res, result);
});

const deleteHandler = wrapMobileHandler('mobile user address delete', async (req, res) => {
  const result = await deleteAddress(req.user.id, req.params.id);
  return sendDataResult(res, result);
});

module.exports = {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
};

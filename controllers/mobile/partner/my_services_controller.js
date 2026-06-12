const {
  listPartnerMyServices,
  updatePartnerMyServices,
  updateOnePartnerServiceStatus,
  updateBulkPartnerServiceStatus,
} = require('../../../services/mobile/partner/my_services_service');
const {
  getCallerId,
  wrapMobileHandler,
  sendSpreadDataResult,
  sendServiceError,
} = require('../../../utils/mobile_controller_helpers');

const list = wrapMobileHandler('mobile partner my-services', async (req, res) => {
  const result = await listPartnerMyServices(getCallerId(req));
  return sendSpreadDataResult(res, result);
});

const update = wrapMobileHandler('mobile partner my-services update', async (req, res) => {
  const result = await updatePartnerMyServices(getCallerId(req), req.body.services);
  if (!result.ok) {
    return sendServiceError(res, result);
  }

  return res.status(200).json({
    success: true,
    status: 200,
    ...result.data,
    message: 'Partner services updated successfully.',
  });
});

const patchStatus = wrapMobileHandler('mobile partner my-services patch status', async (req, res) => {
  const result = await updateOnePartnerServiceStatus(
    getCallerId(req),
    req.params.id,
    req.body.is_active
  );
  return sendSpreadDataResult(res, result);
});

const patchBulkStatus = wrapMobileHandler('mobile partner my-services patch bulk status', async (req, res) => {
  const result = await updateBulkPartnerServiceStatus(getCallerId(req), req.body.updates);
  return sendSpreadDataResult(res, result);
});

module.exports = {
  list,
  update,
  patchStatus,
  patchBulkStatus,
};

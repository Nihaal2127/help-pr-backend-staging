const express = require('express');
const router = express.Router();
const {
  list: listMyServices,
  update: updateMyServices,
  patchStatus: patchMyServiceStatus,
  patchBulkStatus: patchMyServicesBulkStatus,
} = require('../../../controllers/mobile/partner/my_services_controller');
const {
  partnerUpdateMyServicesMiddleware,
  partnerPatchMyServiceStatusMiddleware,
  partnerPatchMyServicesBulkStatusMiddleware,
} = require('../../../middleware/mobile/partner/my_services_middleware');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');

router.get('/my-services', partnerAuthMiddleware, listMyServices);
router.patch(
  '/my-services/status',
  partnerAuthMiddleware,
  partnerPatchMyServicesBulkStatusMiddleware,
  patchMyServicesBulkStatus
);
router.patch(
  '/my-services/:id/status',
  partnerAuthMiddleware,
  partnerPatchMyServiceStatusMiddleware,
  patchMyServiceStatus
);
router.put('/my-services', partnerAuthMiddleware, partnerUpdateMyServicesMiddleware, updateMyServices);

module.exports = router;

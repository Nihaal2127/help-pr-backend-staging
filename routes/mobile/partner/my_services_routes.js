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
const mobileAuthMiddleware = require('../../../middleware/mobile/auth_middleware');

router.get('/my-services', mobileAuthMiddleware, listMyServices);
router.patch(
  '/my-services/status',
  mobileAuthMiddleware,
  partnerPatchMyServicesBulkStatusMiddleware,
  patchMyServicesBulkStatus
);
router.patch(
  '/my-services/:id/status',
  mobileAuthMiddleware,
  partnerPatchMyServiceStatusMiddleware,
  patchMyServiceStatus
);
router.put('/my-services', mobileAuthMiddleware, partnerUpdateMyServicesMiddleware, updateMyServices);

module.exports = router;

const express = require('express');
const router = express.Router();
const { register, login, update } = require('../../../controllers/mobile/partner/partner_controller');
const { categories } = require('../../../controllers/mobile/partner/catalog_controller');
const { list: listSubscriptionPlans } = require('../../../controllers/mobile/partner/subscription_plan_controller');
const {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
  partnerUpdateMiddleware,
  partnerProfileImageSizeMiddleware,
  partnerRequireMultipartMiddleware,
  PARTNER_DOCUMENT_FILE_FIELDS,
} = require('../../../middleware/mobile/partner/partner_middleware');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const quoteRoutes = require('./quote_routes');
const { upload } = require('../../../utils/fileUpload');
const { wrapMulterUpload } = require('../../../utils/multer_error_handler');

const PARTNER_MULTIPART_FIELDS = [
  { name: 'image', maxCount: 1 },
  ...PARTNER_DOCUMENT_FILE_FIELDS.map((name) => ({ name, maxCount: 1 })),
];

const partnerMultipartUpload = wrapMulterUpload(upload.fields(PARTNER_MULTIPART_FIELDS));

router.post('/register', partnerRegisterMiddleware, register);
router.post('/login', partnerLoginMiddleware, login);
router.put(
  '/update',
  partnerAuthMiddleware,
  partnerRequireMultipartMiddleware,
  partnerMultipartUpload,
  partnerProfileImageSizeMiddleware,
  partnerUpdateMiddleware,
  update
);
router.get('/categories', partnerAuthMiddleware, categories);
router.get('/subscription-plans', partnerAuthMiddleware, listSubscriptionPlans);
router.use(quoteRoutes);

module.exports = router;

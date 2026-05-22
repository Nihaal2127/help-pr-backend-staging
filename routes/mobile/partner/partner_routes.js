const express = require('express');
const router = express.Router();
const { register, login, update } = require('../../../controllers/mobile/partner/partner_controller');
const {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
  partnerUpdateMiddleware,
  partnerProfileImageSizeMiddleware,
  partnerRequireMultipartMiddleware,
} = require('../../../middleware/mobile/partner/partner_middleware');
const authMiddleware = require('../../../middleware/auth_middleware');
const { upload } = require('../../../utils/fileUpload');

const PARTNER_MULTIPART_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'vehicle_registration', maxCount: 1 },
  { name: 'police_verification_certificate', maxCount: 1 },
  { name: 'pan_card', maxCount: 1 },
  { name: 'driving_license', maxCount: 1 },
  { name: 'aadhar_card', maxCount: 1 },
];

const partnerMultipartUpload = upload.fields(PARTNER_MULTIPART_FIELDS);

router.post('/register', partnerRegisterMiddleware, register);
router.post('/login', partnerLoginMiddleware, login);
router.put(
  '/update',
  authMiddleware,
  partnerRequireMultipartMiddleware,
  partnerMultipartUpload,
  partnerProfileImageSizeMiddleware,
  partnerUpdateMiddleware,
  update
);

module.exports = router;

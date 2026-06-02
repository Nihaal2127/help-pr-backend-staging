const express = require('express');
const {
  sendOtpHandler,
  verifyOtpHandler,
  updateHandler,
  getPincodesHandler,
} = require('../../../controllers/mobile/user/user_controller');
const { getHomeHandler } = require('../../../controllers/mobile/user/home_controller');
const {
  listPartnersHandler,
  listSavedPartnersHandler,
  savePartnerHandler,
  unsavePartnerHandler,
  getPartnerProfileHandler,
} = require('../../../controllers/mobile/user/partners_controller');
const { validateHomeLocationQuery } = require('../../../middleware/mobile/user/home_middleware');
const {
  validatePartnersListQuery,
  validatePartnerProfileQuery,
  validatePartnerIdParam,
} = require('../../../middleware/mobile/user/partners_middleware');
const {
  rateLimitSendOtp,
  validateVerifyOtp,
  userRequireMultipartMiddleware,
  userProfileImageSizeMiddleware,
  userUpdateMiddleware,
} = require('../../../middleware/mobile/user/user_middleware');
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');
const addressRoutes = require('./address_routes');
const quoteRoutes = require('./quote_routes');
const postRoutes = require('./post_routes');
const { uploadImages } = require('../../../utils/fileUpload');

const userMultipartUpload = uploadImages.fields([{ name: 'profile_photo', maxCount: 1 }]);

const router = express.Router();

router.use(addressRoutes);
router.use(quoteRoutes);
router.use(postRoutes);
router.get('/home', userAuthMiddleware, validateHomeLocationQuery, getHomeHandler);
router.get(
  '/partners',
  userAuthMiddleware,
  validatePartnersListQuery,
  listPartnersHandler
);
router.get('/partners/saved', userAuthMiddleware, listSavedPartnersHandler);
router.post(
  '/partners/:partnerId/save',
  userAuthMiddleware,
  validatePartnerIdParam,
  savePartnerHandler
);
router.delete(
  '/partners/:partnerId/save',
  userAuthMiddleware,
  validatePartnerIdParam,
  unsavePartnerHandler
);
router.get(
  '/partners/:partnerId',
  userAuthMiddleware,
  validatePartnerIdParam,
  validatePartnerProfileQuery,
  getPartnerProfileHandler
);
router.get('/pincodes', userAuthMiddleware, getPincodesHandler);
router.post('/login', rateLimitSendOtp, sendOtpHandler);
router.post('/verify-otp', validateVerifyOtp, verifyOtpHandler);
router.put(
  '/update',
  userAuthMiddleware,
  userRequireMultipartMiddleware,
  userMultipartUpload,
  userProfileImageSizeMiddleware,
  userUpdateMiddleware,
  updateHandler
);

module.exports = router;

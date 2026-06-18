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
  getPartnerRatingsHandler,
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
const orderRoutes = require('./order_routes');
const chatDisputeRoutes = require('./chat_dispute_routes');
const { userNotificationRoutes } = require('../../../src/modules/notifications');
const { uploadImages } = require('../../../utils/fileUpload');

const userMultipartUpload = uploadImages.fields([{ name: 'profile_photo', maxCount: 1 }]);

const router = express.Router();

// Public auth routes must be registered before sub-routers (post_routes applies auth via router.use).
router.post('/login', rateLimitSendOtp, sendOtpHandler);
router.post('/verify-otp', validateVerifyOtp, verifyOtpHandler);

router.use(addressRoutes);
router.use(quoteRoutes);
router.use(postRoutes);
router.use(orderRoutes);
router.use(chatDisputeRoutes);
router.use('/notifications', userNotificationRoutes);
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
  '/partners/:partnerId/ratings',
  userAuthMiddleware,
  validatePartnerIdParam,
  validatePartnerProfileQuery,
  getPartnerRatingsHandler
);
router.get(
  '/partners/:partnerId',
  userAuthMiddleware,
  validatePartnerIdParam,
  validatePartnerProfileQuery,
  getPartnerProfileHandler
);
router.get('/pincodes', userAuthMiddleware, getPincodesHandler);
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

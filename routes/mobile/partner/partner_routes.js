const express = require('express');
const router = express.Router();
const { register, login, sendPartnerOtpHandler, verifyPartnerOtpHandler, googleLogin, appleLogin, forgotPassword, verifyForgotPasswordOtp, resetPassword, update, logout, deleteAccount } = require('../../../controllers/mobile/partner/partner_controller');
const {
  validateForgotPasswordEmail,
  validateVerifyForgotPasswordOtp,
  validateResetPassword,
} = require('../../../middleware/mobile/common/forgot_password_middleware');
const { categories } = require('../../../controllers/mobile/partner/catalog_controller');
const { list: listSubscriptionPlans } = require('../../../controllers/mobile/partner/subscription_plan_controller');
const {
  partnerRegisterMiddleware,
  partnerLoginMiddleware,
  rateLimitPartnerSendOtp,
  validatePartnerVerifyOtp,
  partnerGoogleLoginMiddleware,
  partnerAppleLoginMiddleware,
  partnerUpdateMiddleware,
  partnerProfileImageSizeMiddleware,
  partnerRequireMultipartMiddleware,
  PARTNER_DOCUMENT_FILE_FIELDS,
} = require('../../../middleware/mobile/partner/partner_middleware');
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const { validateRequiredServiceIdQuery } = require('../../../middleware/mobile/common/ratings_query_middleware');
const { getHomeHandler } = require('../../../controllers/mobile/partner/home_controller');
const { listOwnServiceRatingsHandler } = require('../../../controllers/mobile/partner/ratings_controller');
const quoteRoutes = require('./quote_routes');
const orderRoutes = require('./order_routes');
const appointmentRoutes = require('./appointment_routes');
const postRoutes = require('./post_routes');
const { partnerNotificationRoutes } = require('../../../src/modules/notifications');
const { upload } = require('../../../utils/fileUpload');
const { wrapMulterUpload } = require('../../../utils/multer_error_handler');

const PARTNER_MULTIPART_FIELDS = [
  { name: 'image', maxCount: 1 },
  ...PARTNER_DOCUMENT_FILE_FIELDS.map((name) => ({ name, maxCount: 1 })),
];

const partnerMultipartUpload = wrapMulterUpload(upload.fields(PARTNER_MULTIPART_FIELDS));

router.post('/register', partnerRegisterMiddleware, register);
router.post('/login', partnerLoginMiddleware, login);
router.post('/phone-login', rateLimitPartnerSendOtp, sendPartnerOtpHandler);
router.post('/verify-otp', validatePartnerVerifyOtp, verifyPartnerOtpHandler);
router.post('/google-login', partnerGoogleLoginMiddleware, googleLogin);
router.post('/apple-login', partnerAppleLoginMiddleware, appleLogin);
router.post('/forgot-password', validateForgotPasswordEmail, forgotPassword);
router.post(
  '/verify-forgot-password-otp',
  validateVerifyForgotPasswordOtp,
  verifyForgotPasswordOtp
);
router.post('/reset-password', validateResetPassword, resetPassword);
router.post('/logout', partnerAuthMiddleware, logout);
router.delete('/delete', partnerAuthMiddleware, requirePartnerAccount, deleteAccount);
router.get('/home', partnerAuthMiddleware, requirePartnerAccount, getHomeHandler);
router.get(
  '/ratings',
  partnerAuthMiddleware,
  requirePartnerAccount,
  validateRequiredServiceIdQuery,
  listOwnServiceRatingsHandler
);
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
router.use(orderRoutes);
router.use('/appointments', appointmentRoutes);
router.use(postRoutes);
router.use('/notifications', partnerNotificationRoutes);

module.exports = router;

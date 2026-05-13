const express = require('express');
const router = express.Router();
const {getAll, create,update,  getById,  deleteUser,getDropDown,getVerificationAll,changePassword,getPartnerDropDown} = require('../controllers/user_controller');
const authMiddleware = require('../middleware/auth_middleware');
// const rateLimiter = require('../middleware/rate_middleware');
const {createUserMiddleware, updateUserMiddleware,getPartnerDropDownMiddleware, changePasswordMiddleware, enforcePartnerProfileImageSize} = require('../middleware/user_middleware');
const { authorizeUserCreate } = require('../middleware/user_create_authorization_middleware');
const { publicPartnerRegisterMiddleware } = require('../middleware/public_partner_register_middleware');
const { requireSuperAdmin } = require('../middleware/role_middleware');
const { uploadImages, upload } = require('../utils/fileUpload');

/** When Content-Type is multipart, accept profile `image` plus partner verification file fields (same names as dashboard). JSON-only creates skip multer. */
const USER_MULTIPART_PARTNER_DOC_FIELDS = [
  { name: 'image', maxCount: 1 },
  { name: 'vehicle_registration', maxCount: 1 },
  { name: 'police_verification_certificate', maxCount: 1 },
  { name: 'pan_card', maxCount: 1 },
  { name: 'driving_license', maxCount: 1 },
  { name: 'aadhar_card', maxCount: 1 },
];

const userMultipartUploadIfNeeded = (req, res, next) => {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('multipart/form-data')) {
    return upload.fields(USER_MULTIPART_PARTNER_DOC_FIELDS)(req, res, next);
  }
  next();
};
// Apply rate limiting middleware to sensitive routes
// router.use(rateLimiter);

// Public route: Get all users
// router.get('/', getUsers);


router.post('/changePassword', authMiddleware, changePasswordMiddleware, changePassword);
router.post(
  '/register-partner',
  uploadImages.single('image'),
  enforcePartnerProfileImageSize,
  publicPartnerRegisterMiddleware,
  createUserMiddleware,
  create
);
router.post('/create', userMultipartUploadIfNeeded, enforcePartnerProfileImageSize, authMiddleware, authorizeUserCreate, createUserMiddleware, create);

// // Protected route: Create a new user
router.get('/getAll', authMiddleware, getAll);
router.get('/getVerificationAll', authMiddleware, getVerificationAll);
router.get('/get/:id', authMiddleware, getById);
router.get('/getDropDown', authMiddleware, requireSuperAdmin, getDropDown);
router.get('/getPartnerDropDown', authMiddleware, getPartnerDropDownMiddleware,getPartnerDropDown);

router.put('/update/:id', authMiddleware, userMultipartUploadIfNeeded, enforcePartnerProfileImageSize, updateUserMiddleware, update);
router.delete('/delete/:id',authMiddleware, deleteUser);
// router.post('/', authMiddleware, userValidationRules, validate, createUser);

module.exports = router;
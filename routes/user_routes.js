const express = require('express');
const router = express.Router();
const {getAll, create,update,  getById,  deleteUser,getDropDown,getVerificationAll,changePassword,getPartnerDropDown} = require('../controllers/user_controller');
const authMiddleware = require('../middleware/auth_middleware');
// const rateLimiter = require('../middleware/rate_middleware');
const {createUserMiddleware, updateUserMiddleware,getPartnerDropDownMiddleware, changePasswordMiddleware} = require('../middleware/user_middleware');
const { authorizeUserCreate } = require('../middleware/user_create_authorization_middleware');
const { requireSuperAdmin } = require('../middleware/role_middleware');
const { uploadImages } = require('../utils/fileUpload');
// Apply rate limiting middleware to sensitive routes
// router.use(rateLimiter);

// Public route: Get all users
// router.get('/', getUsers);


router.post('/changePassword', authMiddleware, changePasswordMiddleware, changePassword);
router.post('/create', uploadImages.single('image'), authMiddleware, authorizeUserCreate, createUserMiddleware, create);

// // Protected route: Create a new user
router.get('/getAll', authMiddleware, getAll);
router.get('/getVerificationAll', authMiddleware, getVerificationAll);
router.get('/get/:id', authMiddleware, getById);
router.get('/getDropDown', authMiddleware, requireSuperAdmin, getDropDown);
router.get('/getPartnerDropDown', authMiddleware, getPartnerDropDownMiddleware,getPartnerDropDown);

router.put('/update/:id',authMiddleware, uploadImages.single('image'), updateUserMiddleware, update);
router.delete('/delete/:id',authMiddleware, deleteUser);
// router.post('/', authMiddleware, userValidationRules, validate, createUser);

module.exports = router;
const express = require('express');
const router = express.Router();
const { login, logout,forgotPassword,userLogin} = require('../controllers/auth_controller');
const authMiddleware = require('../middleware/auth_middleware');

router.post('/userLogin', userLogin);
router.post('/login', login);
router.post('/logout',  authMiddleware,logout);
router.post('/forgotPassword', forgotPassword);
module.exports = router;
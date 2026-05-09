const express = require('express');
const router = express.Router();
const { getAll, create,updateStatus, deleteState, getDropDown} = require('../controllers/partner_service_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {checkServiceMiddleware} = require('../middleware/partner_service_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post('/create', authMiddleware, checkServiceMiddleware, create);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', getDropDown);
router.post('/updateStatus/:id',authMiddleware,updateStatus);
router.delete('/delete/:id',authMiddleware, deleteState);
module.exports = router;
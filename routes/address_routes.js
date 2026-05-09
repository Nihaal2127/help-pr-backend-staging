const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteAddress} = require('../controllers/address_controller');
const authMiddleware = require('../middleware/auth_middleware');
const {createAddressMiddleware, updateAddressMiddleware} = require('../middleware/address_middleware');
// Apply rate limiting middleware to sensitive routes



router.post('/create', authMiddleware, createAddressMiddleware, create);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.put('/update/:id',authMiddleware,updateAddressMiddleware,update);
router.delete('/delete/:id',authMiddleware, deleteAddress);
module.exports = router;
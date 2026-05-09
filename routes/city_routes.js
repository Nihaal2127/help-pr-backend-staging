const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteCity, importRecords,getDropDown} = require('../controllers/city_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {createCityMiddleware, updateCityMiddleware} = require('../middleware/city_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post('/create', authMiddleware, createCityMiddleware, create);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', getDropDown);
router.put('/update/:id',authMiddleware,updateCityMiddleware,update);
router.delete('/delete/:id',authMiddleware, deleteCity);
module.exports = router;
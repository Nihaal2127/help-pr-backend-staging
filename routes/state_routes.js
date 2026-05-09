const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteState, importRecords,getDropDown} = require('../controllers/state_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {createStateMiddleware, updateStateMiddleware} = require('../middleware/state_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post('/create', authMiddleware, createStateMiddleware, create);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', getDropDown);
router.put('/update/:id',authMiddleware,updateStateMiddleware,update);
router.delete('/delete/:id',authMiddleware, deleteState);
module.exports = router;
const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deleteArea,
    importRecords,
    getDropDown,
} = require('../controllers/area_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { createAreaMiddleware, updateAreaMiddleware } = require('../middleware/area_middleware');

router.use(rateLimiter);

router.post('/create', authMiddleware, createAreaMiddleware, create);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', getDropDown);
router.put('/update/:id', authMiddleware, updateAreaMiddleware, update);
router.delete('/delete/:id', authMiddleware, deleteArea);

module.exports = router;

const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deleteFranchise,
    importRecords,
    getDropDown,
} = require('../controllers/franchise_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requireSuperAdminOrStaff } = require('../middleware/role_middleware');
const {
    createFranchiseMiddleware,
    updateFranchiseMiddleware,
} = require('../middleware/franchise_middleware');

router.use(rateLimiter);

router.post('/create', authMiddleware, createFranchiseMiddleware, create);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', authMiddleware, getDropDown);
router.put('/update/:id', authMiddleware, updateFranchiseMiddleware, update);
router.delete('/delete/:id', authMiddleware, deleteFranchise);

module.exports = router;

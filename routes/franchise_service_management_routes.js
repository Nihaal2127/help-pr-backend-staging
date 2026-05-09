const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    requireSuperAdminOrStaff,
    requireSuperAdminStaffFranchiseAdminEmployee,
} = require('../middleware/role_middleware');
const {
    create,
    getAll,
    getById,
    update,
} = require('../controllers/franchise_service_management_controller');

router.use(rateLimiter);

router.post('/create', authMiddleware, requireSuperAdminOrStaff, create);
router.get('/getAll', authMiddleware, requireSuperAdminStaffFranchiseAdminEmployee, getAll);
router.get('/get/:id', authMiddleware, requireSuperAdminStaffFranchiseAdminEmployee, getById);
router.put('/update/:id', authMiddleware, requireSuperAdminStaffFranchiseAdminEmployee, update);

module.exports = router;

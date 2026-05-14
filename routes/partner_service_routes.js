const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    updateStatus,
    deleteState,
    getDropDown,
    getMyServices,
    getAvailableServices,
    getAvailableFranchiseCategories,
    getAvailableFranchiseServices,
    addMyServices,
    updateMyService,
    toggleMyServiceStatus,
    getFranchiseCategoryServicesIntersection,
} = require('../controllers/partner_service_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { checkServiceMiddleware } = require('../middleware/partner_service_middleware');
const { requirePartner, requireBackoffice } = require('../middleware/role_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

// Back-office routes (Super Admin, Admin, Staff, Employee)
router.post('/create', authMiddleware, requireBackoffice, checkServiceMiddleware, create);
router.get('/getAll', authMiddleware, requireBackoffice, getAll);
router.get('/getDropDown', authMiddleware, requireBackoffice, getDropDown);
router.post(
  '/franchiseCategoryServices',
  authMiddleware,
  requireBackoffice,
  getFranchiseCategoryServicesIntersection
);
router.post('/updateStatus/:id', authMiddleware, requireBackoffice, updateStatus);
router.delete('/delete/:id', authMiddleware, requireBackoffice, deleteState);

// Partner-scoped routes (partner_id is taken from JWT)
router.get('/myServices', authMiddleware, requirePartner, getMyServices);
router.get('/availableServices', authMiddleware, requirePartner, getAvailableServices);
router.get(
    '/availableFranchiseCategories',
    authMiddleware,
    requirePartner,
    getAvailableFranchiseCategories
);
router.get(
    '/availableFranchiseServices',
    authMiddleware,
    requirePartner,
    getAvailableFranchiseServices
);
router.post('/addMyServices', authMiddleware, requirePartner, addMyServices);
router.put('/updateMyService/:id', authMiddleware, requirePartner, updateMyService);
router.post('/toggleMyServiceStatus/:id', authMiddleware, requirePartner, toggleMyServiceStatus);

module.exports = router;
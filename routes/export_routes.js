const express = require('express');
const router = express.Router();
const {
    exportState,
    exportCity,
    exportArea,
    exportFranchise,
    exportCategory,
    exportService,
    exportUserList,
    exportOrders,
    exportOrderReport,
    exportQuoteReport,
    exportPartnerReport,
    exportOrderPayments,
    exportUserServices,
    exportTicket,
    exportVerification,
    exportUser,
    exportPartner,
} = require('../controllers/export_controller');

const authMiddleware = require('../middleware/auth_middleware');

router.post('/state',authMiddleware, exportState);
router.post('/city', authMiddleware, exportCity);
router.post('/area', authMiddleware, exportArea);
router.post('/franchise', authMiddleware, exportFranchise);
router.post('/category', authMiddleware,  exportCategory);
router.post('/service', authMiddleware,  exportService);
router.post('/user_role',authMiddleware,  exportUserList);
router.post('/orders',authMiddleware,  exportOrders);
router.post('/order-report', authMiddleware, exportOrderReport);
router.post('/quote-report', authMiddleware, exportQuoteReport);
router.post('/partner-report', authMiddleware, exportPartnerReport);
router.post('/orders_payments',authMiddleware,  exportOrderPayments);
router.post('/user_service',authMiddleware,  exportUserServices);
router.post('/tickets',authMiddleware,  exportTicket);
router.post('/verification',authMiddleware,  exportVerification);
router.post('/user',authMiddleware, exportUser);
router.post('/partner',authMiddleware,  exportPartner);

module.exports = router;
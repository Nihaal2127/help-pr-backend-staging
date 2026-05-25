const express = require('express');
const router = express.Router();
const { getAll, create,update,cancleOrder,serviceUpdate,  getById, /* deleteOrder, */ cancleService,getCustomerOrder, downloadOrderInvoice, sendInvoiceEmail} = require('../controllers/order_controller');
const {
    getFinancialPaymentsAll,
    getFinancialPaymentById,
} = require('../controllers/order_financial_payments_controller');
const authMiddleware = require('../middleware/auth_middleware');
// const rateLimiter = require('../middleware/rate_middleware');
const {createOrderMiddleware, checkItemsMiddleware,updateOrderServiceMiddleware} = require('../middleware/order_middleware');
const { updateOrderMiddleware } = require('../middleware/update_order_middleware');
const { uploadPdf } = require('../utils/fileUpload');
// Apply rate limiting middleware to sensitive routes

// router.use(rateLimiter);

router.post('/create', authMiddleware, createOrderMiddleware,checkItemsMiddleware, create);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/financial-payments/getAll', authMiddleware, getFinancialPaymentsAll);
const { validateOrderIdParam } = require('../middleware/validate_order_id_param');
router.get('/financial-payments/get/:id', authMiddleware, validateOrderIdParam, getFinancialPaymentById);
router.get('/getCustomerOrder', authMiddleware, getCustomerOrder);
router.put('/update/:id',authMiddleware,updateOrderMiddleware,update);
router.put('/serviceUpdate/:id',authMiddleware,updateOrderServiceMiddleware,serviceUpdate);
router.put('/cancleService/:id',authMiddleware,cancleService);
router.put('/cancle/:id',authMiddleware,cancleOrder);
// Disabled until needed — uncomment deleteOrder import above when re-enabling.
// router.delete('/delete/:id', authMiddleware, deleteOrder);
router.get('/invoice/:id', authMiddleware, downloadOrderInvoice);
router.post('/send-invoice-email', authMiddleware, uploadPdf.single('file'), sendInvoiceEmail);
module.exports = router;
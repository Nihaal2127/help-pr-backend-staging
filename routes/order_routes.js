const express = require('express');
const router = express.Router();
const { getAll, create,update,cancleOrder,serviceUpdate,  getById,  deleteOrder,cancleService,getCustomerOrder, downloadOrderInvoice, sendInvoiceEmail} = require('../controllers/order_controller');
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
router.get('/getCustomerOrder', authMiddleware, getCustomerOrder);
router.put('/update/:id',authMiddleware,updateOrderMiddleware,update);
router.put('/serviceUpdate/:id',authMiddleware,updateOrderServiceMiddleware,serviceUpdate);
router.put('/cancleService/:id',authMiddleware,cancleService);
router.put('/cancle/:id',authMiddleware,cancleOrder);
router.delete('/delete/:id',authMiddleware, deleteOrder);
router.get('/invoice/:id', authMiddleware, downloadOrderInvoice);
router.post('/send-invoice-email', authMiddleware, uploadPdf.single('file'), sendInvoiceEmail);
module.exports = router;
const express = require('express');
const router = express.Router();
const {getAll, create,updateDocumentStatus,updateDocument,  getById,  deleteDocument} = require('../controllers/partner_document_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {createUserMiddleware, updateUserMiddleware} = require('../middleware/user_middleware');

router.use(rateLimiter);


router.post('/create', createUserMiddleware, create);
router.put('/updateStatus/:id',authMiddleware,updateUserMiddleware, updateDocumentStatus);
router.put('/updateDocument/:id',authMiddleware, updateDocument);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.delete('/delete/:id',authMiddleware, deleteDocument);

module.exports = router;
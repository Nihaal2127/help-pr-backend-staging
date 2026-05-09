const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteDocument, getDropDown} = require('../controllers/document_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {createDocumentMiddleware, updateDocumentMiddleware} = require('../middleware/document_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post('/create', authMiddleware, createDocumentMiddleware, create);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', authMiddleware, getDropDown);
router.put('/update/:id',authMiddleware,updateDocumentMiddleware,update);
router.delete('/delete/:id',authMiddleware, deleteDocument);
module.exports = router;
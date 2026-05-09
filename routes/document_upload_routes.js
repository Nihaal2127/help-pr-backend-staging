const express = require('express');
const router = express.Router();
const { uploadDocument, updateDocument } = require('../controllers/document_upload_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {upload} = require("../utils/fileUpload");

router.use(rateLimiter);

router.post('/files', authMiddleware,  upload.array('files', 5),uploadDocument);
router.put('/update_files',authMiddleware, upload.array('files', 5),updateDocument);
module.exports = router;
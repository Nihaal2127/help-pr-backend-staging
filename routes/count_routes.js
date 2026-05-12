const express = require('express');
const router = express.Router();
const { getCountData, getPartnerServiceCount,getHomeCount } = require('../controllers/count_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { stripDuplicateRecordsFromGetCountResponse } = require('../middleware/count_middleware');
router.use(rateLimiter);

router.post('/getCount', authMiddleware, stripDuplicateRecordsFromGetCountResponse, getCountData);
router.get('/getPartnerServiceCount', rateLimiter, authMiddleware, getPartnerServiceCount);
router.get('/getHomeCount', rateLimiter, authMiddleware, getHomeCount);
module.exports = router;

const express = require('express');
const router = express.Router();
const {
    getAll,
    getPartners,
    create,
    show,
} = require('../controllers/partner_payout_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    createPartnerPayoutMiddleware,
    validatePartnerLedgerQuery,
} = require('../middleware/partner_payout_middleware');

router.use(rateLimiter);

router.get('/getAll', authMiddleware, getAll);
router.get('/partners', authMiddleware, getPartners);
router.get('/show', authMiddleware, validatePartnerLedgerQuery, show);
router.post('/create', authMiddleware, createPartnerPayoutMiddleware, create);

module.exports = router;

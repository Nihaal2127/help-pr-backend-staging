const express = require('express');
const router = express.Router();
const {
    getAll,
    create,
    update,
    getById,
    deleteOffer,
} = require('../controllers/offer_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const {
    validateOfferIdParam,
    requireOfferCreatePermission,
    createOfferMiddleware,
    updateOfferMiddleware,
} = require('../middleware/offer_middleware');

router.use(rateLimiter);
router.use(authMiddleware, requireOfferCreatePermission);

router.post('/create', createOfferMiddleware, create);
router.get('/get/:id', validateOfferIdParam, getById);
router.get('/getAll', getAll);
router.put('/update/:id', validateOfferIdParam, updateOfferMiddleware, update);
router.delete('/delete/:id', validateOfferIdParam, deleteOffer);

module.exports = router;

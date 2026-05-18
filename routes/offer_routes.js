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
    createOfferMiddleware,
    updateOfferMiddleware,
} = require('../middleware/offer_middleware');

router.use(rateLimiter);

router.post('/create', authMiddleware, createOfferMiddleware, create);
router.get('/get/:id', authMiddleware, validateOfferIdParam, getById);
router.get('/getAll', authMiddleware, getAll);
router.put('/update/:id', authMiddleware, validateOfferIdParam, updateOfferMiddleware, update);
router.delete('/delete/:id', authMiddleware, validateOfferIdParam, deleteOffer);

module.exports = router;

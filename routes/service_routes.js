const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteService, importRecords,getDropDown} = require('../controllers/service_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requireFranchiseRelatedCatalogAccess } = require('../middleware/role_middleware');
const {
  serviceCreateParser,
  serviceUpdateParser,
  createServiceMiddleware,
  createServiceRequestMiddleware,
  updateServiceRequestMiddleware,
  updateServiceMiddleware,
  prepareServiceCreateBody,
  prepareServiceUpdateBody,
} = require('../middleware/service_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post(
  '/create',
  authMiddleware,
  serviceCreateParser,
  prepareServiceCreateBody,
  createServiceMiddleware,
  create
);
router.post(
  '/create-request',
  authMiddleware,
  serviceCreateParser,
  prepareServiceCreateBody,
  createServiceRequestMiddleware,
  create
);
// router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll/:franchise_id', authMiddleware, requireFranchiseRelatedCatalogAccess, getAll);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', authMiddleware, getDropDown);
router.put(
  '/update/:id',
  authMiddleware,
  serviceUpdateParser,
  prepareServiceUpdateBody,
  updateServiceMiddleware,
  update
);
router.put(
  '/update-request/:id',
  authMiddleware,
  serviceUpdateParser,
  prepareServiceUpdateBody,
  updateServiceRequestMiddleware,
  update
);
router.delete('/delete/:id',authMiddleware, deleteService);
module.exports = router;

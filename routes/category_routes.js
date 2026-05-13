const express = require('express');
const router = express.Router();
const { getAll, create,update,  getById,  deleteCategory, importRecords,getDropDown} = require('../controllers/category_controller');
const authMiddleware = require('../middleware/auth_middleware');
const rateLimiter = require('../middleware/rate_middleware');
const { requireFranchiseRelatedCatalogAccess } = require('../middleware/role_middleware');
const {
  categoryCreateParser,
  categoryUpdateParser,
  createCategoryMiddleware,
  createCategoryRequestMiddleware,
  updateCategoryRequestMiddleware,
  updateCategoryMiddleware,
  updateCategoryRoleMiddleware,
  prepareCategoryCreateBody,
  prepareCategoryUpdateBody,
} = require('../middleware/category_middleware');
// Apply rate limiting middleware to sensitive routes

router.use(rateLimiter);

router.post(
  '/create',
  authMiddleware,
  categoryCreateParser,
  prepareCategoryCreateBody,
  createCategoryMiddleware,
  create
);
router.post(
  '/create-request',
  authMiddleware,
  categoryCreateParser,
  prepareCategoryCreateBody,
  createCategoryRequestMiddleware,
  create
);
router.post('/imports', authMiddleware, importRecords);
router.get('/get/:id', authMiddleware, getById);
router.get('/getAll/:franchise_id', authMiddleware, requireFranchiseRelatedCatalogAccess, getAll);
router.get('/getAll', authMiddleware, getAll);
router.get('/getDropDown', authMiddleware, getDropDown);
router.put(
  '/update/:id',
  authMiddleware,
  categoryUpdateParser,
  prepareCategoryUpdateBody,
  updateCategoryRoleMiddleware,
  updateCategoryMiddleware,
  update
);
router.put(
  '/update-request/:id',
  authMiddleware,
  categoryUpdateParser,
  prepareCategoryUpdateBody,
  updateCategoryRequestMiddleware,
  update
);
router.delete('/delete/:id',authMiddleware, deleteCategory);
module.exports = router;
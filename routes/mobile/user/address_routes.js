const express = require('express');
const router = express.Router();
const {
  listHandler,
  createHandler,
  updateHandler,
  deleteHandler,
} = require('../../../controllers/mobile/user/address_controller');
const {
  normalizeAddressDropdownFields,
  validateCreateAddress,
  validateUpdateAddress,
  validateAddressIdParam,
} = require('../../../middleware/mobile/user/address_middleware');
const userAuthMiddleware = require('../../../middleware/mobile/user/user_auth_middleware');

router.get('/addresses', userAuthMiddleware, listHandler);
router.post(
  '/addresses',
  userAuthMiddleware,
  normalizeAddressDropdownFields,
  validateCreateAddress,
  createHandler
);
router.put(
  '/addresses/:id',
  userAuthMiddleware,
  validateAddressIdParam,
  normalizeAddressDropdownFields,
  validateUpdateAddress,
  updateHandler
);
router.delete('/addresses/:id', userAuthMiddleware, validateAddressIdParam, deleteHandler);

module.exports = router;

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

router.get('/addresses/get', userAuthMiddleware, listHandler);
router.post(
  '/addresses/create',
  userAuthMiddleware,
  normalizeAddressDropdownFields,
  validateCreateAddress,
  createHandler
);
router.put(
  '/addresses/update/:id',
  userAuthMiddleware,
  validateAddressIdParam,
  normalizeAddressDropdownFields,
  validateUpdateAddress,
  updateHandler
);
router.delete('/addresses/delete/:id', userAuthMiddleware, validateAddressIdParam, deleteHandler);

module.exports = router;

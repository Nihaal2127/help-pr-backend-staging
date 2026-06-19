const express = require('express');
const router = express.Router();
const partnerAuthMiddleware = require('../../../middleware/mobile/partner/partner_auth_middleware');
const { requirePartnerAccount } = require('../../../middleware/mobile/partner/quote_middleware');
const { validateOrderIdParam } = require('../../../middleware/mobile/partner/order_middleware');
const {
  validateUpdateWorkStatusBody,
  validateCompleteOrderWorkBody,
} = require('../../../middleware/mobile/partner/order_work_middleware');
const {
  listOrdersHandler,
  getOrderDetailsHandler,
  downloadOrderInvoiceHandler,
  updateWorkStatusHandler,
  completeOrderWorkHandler,
} = require('../../../controllers/mobile/partner/order_controller');
const {
  listOrderAdditionalChargesHandler,
  createOrderAdditionalChargeHandler,
  updateOrderAdditionalChargeHandler,
  deleteOrderAdditionalChargeHandler,
} = require('../../../controllers/mobile/partner/order_additional_charge_controller');
const {
  validateChargeIdParam,
  validateCreateAdditionalChargeBody,
  validateUpdateAdditionalChargeBody,
} = require('../../../middleware/mobile/partner/order_additional_charge_middleware');
const { uploadImages } = require('../../../utils/fileUpload');
const { wrapMulterUpload } = require('../../../utils/multer_error_handler');

const orderProofImagesUpload = wrapMulterUpload(uploadImages.array('images', 4));

router.use(partnerAuthMiddleware, requirePartnerAccount);

router.get('/orders', listOrdersHandler);
router.put(
  '/orders/:orderId/work-status',
  validateOrderIdParam,
  validateUpdateWorkStatusBody,
  updateWorkStatusHandler
);
router.post(
  '/orders/:orderId/complete',
  validateOrderIdParam,
  orderProofImagesUpload,
  validateCompleteOrderWorkBody,
  completeOrderWorkHandler
);
router.get(
  '/orders/:orderId/additional-charges',
  validateOrderIdParam,
  listOrderAdditionalChargesHandler
);
router.post(
  '/orders/:orderId/additional-charges',
  validateOrderIdParam,
  validateCreateAdditionalChargeBody,
  createOrderAdditionalChargeHandler
);
router.put(
  '/orders/:orderId/additional-charges/:chargeId',
  validateOrderIdParam,
  validateChargeIdParam,
  validateUpdateAdditionalChargeBody,
  updateOrderAdditionalChargeHandler
);
router.delete(
  '/orders/:orderId/additional-charges/:chargeId',
  validateOrderIdParam,
  validateChargeIdParam,
  deleteOrderAdditionalChargeHandler
);
router.get(
  '/orders/:orderId/invoice',
  validateOrderIdParam,
  downloadOrderInvoiceHandler
);
router.get('/orders/:orderId', validateOrderIdParam, getOrderDetailsHandler);

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const {
  create,
  listByOrder,
  update,
  remove,
  paymentStatus,
} = require("../controllers/order_payment_controller");

router.post("/create", authMiddleware, create);
router.get("/payment-status/:id", authMiddleware, paymentStatus);
router.get("/by-order/:orderId", authMiddleware, listByOrder);
router.put("/update/:id", authMiddleware, update);
router.delete("/delete/:id", authMiddleware, remove);

module.exports = router;

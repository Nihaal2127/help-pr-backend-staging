const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const {
  create,
  listByOrder,
  update,
  remove,
} = require("../controllers/order_additional_charge_controller");

router.post("/create", authMiddleware, create);
router.get("/by-order/:orderId", authMiddleware, listByOrder);
router.put("/update/:id", authMiddleware, update);
router.delete("/delete/:id", authMiddleware, remove);

module.exports = router;

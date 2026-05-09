const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const {
  createQuoteMiddleware,
  updateQuoteMiddleware,
  convertQuoteMiddleware,
} = require("../middleware/quote_middleware");
const {
  create,
  getAll,
  getById,
  getCustomerQuotes,
  update,
  approve,
  reject,
  cancelQuote,
  convertToOrder,
  deleteQuote,
} = require("../controllers/quote_controller");

router.post("/create", authMiddleware, createQuoteMiddleware, create);
router.get("/getAll", authMiddleware, getAll);
router.get("/get/:id", authMiddleware, getById);
router.get("/getCustomerQuotes", authMiddleware, getCustomerQuotes);
router.put("/update/:id", authMiddleware, updateQuoteMiddleware, update);
router.put("/approve/:id", authMiddleware, approve);
router.put("/reject/:id", authMiddleware, reject);
router.put("/cancel/:id", authMiddleware, cancelQuote);
router.post("/convert/:id", authMiddleware, convertQuoteMiddleware, convertToOrder);
router.delete("/delete/:id", authMiddleware, deleteQuote);

module.exports = router;

const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth_middleware");
const {
  createQuoteMiddleware,
  updateQuoteMiddleware,
} = require("../middleware/quote_middleware");
const {
  create,
  getAll,
  getQuoteCounts,
  getById,
  getCustomerQuotes,
  update,
  // deleteQuote,
} = require("../controllers/quote_controller");

router.post("/create", authMiddleware, createQuoteMiddleware, create);
router.get("/getAll", authMiddleware, getAll);
router.get("/getCounts", authMiddleware, getQuoteCounts);
router.get("/get/:id", authMiddleware, getById);
router.get("/getCustomerQuotes", authMiddleware, getCustomerQuotes);
router.put("/update/:id", authMiddleware, updateQuoteMiddleware, update);
// Disabled until needed — uncomment deleteQuote import above when re-enabling.
// router.delete("/delete/:id", authMiddleware, deleteQuote);

module.exports = router;

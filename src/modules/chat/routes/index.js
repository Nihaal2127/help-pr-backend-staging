const express = require("express");
const chatRoutes = require("./chat.routes");
const messageRoutes = require("./message.routes");

const router = express.Router();

router.use("/", chatRoutes);
router.use("/", messageRoutes);

module.exports = router;

const chatRoutes = require("./routes");
const { registerChatSocket } = require("./sockets");

module.exports = {
  chatRoutes,
  registerChatSocket,
};

let io = null;

const setChatIo = (ioInstance) => {
  io = ioInstance;
};

const emitToChat = (chatId, event, payload) => {
  if (!io || !chatId) return;
  io.to(String(chatId)).emit(event, payload);
};

module.exports = {
  setChatIo,
  emitToChat,
};

class ChatError extends Error {
    constructor(message, status = 400, code = "CHAT_ERROR") {
      super(message);
      this.name = "ChatError";
      this.status = status;
      this.code = code;
    }
  }
  
  module.exports = ChatError;
  
const messageService = require("../services/message.service");
const ChatError = require("../utils/chatError");

const handleError = (res, error) => {
  if (error instanceof ChatError) {
    return res.status(error.status).json({
      success: false,
      status: error.status,
      message: error.message,
      code: error.code,
    });
  }
  return res.status(500).json({
    success: false,
    status: 500,
    message: "Internal server error.",
  });
};

const sendMessage = async (req, res) => {
  try {
    const payload = {
      ...req.body,
      senderId: req.user.id,
    };
    const message = await messageService.sendMessage(payload);
    return res.status(201).json({
      success: true,
      status: 201,
      message: "Message sent successfully.",
      record: message,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getMessages = async (req, res) => {
  try {
    const messages = await messageService.getMessages(req.query.chatId, {
      after: req.query.after,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Messages fetched successfully.",
      records: messages,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  sendMessage,
  getMessages,
};

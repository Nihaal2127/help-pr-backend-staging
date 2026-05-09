const chatService = require("../services/chat.service");
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

const createChat = async (req, res) => {
  try {
    const chat = await chatService.createChat(req.body);
    return res.status(201).json({
      success: true,
      status: 201,
      message: "Chat created successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getChats = async (req, res) => {
  try {
    const chats = await chatService.getUserChats(req.user.id);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chats fetched successfully.",
      records: chats,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getChat = async (req, res) => {
  try {
    const chat = await chatService.getChatById(req.params.id);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chat fetched successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const transferChat = async (req, res) => {
  try {
    const chat = await chatService.transferChat(req.params.id, req.body.newAssignedTo);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chat transferred successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const convertChat = async (req, res) => {
  try {
    const chat = await chatService.convertChat(req.params.id, req.body.type, req.body.context || {});
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chat converted successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const addMembers = async (req, res) => {
  try {
    const chat = await chatService.addParticipants(req.params.id, req.body.userIds);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Members added successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const removeMember = async (req, res) => {
  try {
    const chat = await chatService.removeParticipant(req.params.id, req.params.userId);
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Member removed successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  createChat,
  getChats,
  getChat,
  transferChat,
  convertChat,
  addMembers,
  removeMember,
};

const chatService = require("../services/chat.service");
const {
  createOrGetSupportChat,
  getOrderChatForUser,
} = require("../services/chatProvisioning.service");
const ChatError = require("../utils/chatError");
const {
  USER_TYPE_CUSTOMER,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_ADMIN,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
} = require("../../../../constants/user_types");

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
    const chat = await chatService.createChat(req.body, req.user.id);
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
    const chats = await chatService.getUserChatsWithUnread(req.user.id);
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
    const chat = await chatService.getChatById(req.params.id, req.user.id, req.user.type);
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
    const chat = await chatService.transferChat(
      req.params.id,
      req.body.newAssignedTo,
      req.user.id,
      req.user.type
    );
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
    const chat = await chatService.convertChat(
      req.params.id,
      req.body.type,
      req.body.context || {},
      req.user.id,
      req.user.type
    );
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
    const chat = await chatService.addParticipants(
      req.params.id,
      req.body.userIds,
      req.user.id,
      req.user.type
    );
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
    const chat = await chatService.removeParticipant(
      req.params.id,
      req.params.userId,
      req.user.id,
      req.user.type
    );
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

const createSupportChat = async (req, res) => {
  try {
    const callerType = Number(req.user.type);
    const isCustomer = callerType === USER_TYPE_CUSTOMER;
    const isBackOffice = [
      USER_TYPE_ADMIN,
      USER_TYPE_EMPLOYEE,
      USER_TYPE_SUPER_ADMIN,
      USER_TYPE_STAFF,
    ].includes(callerType);

    if (!isCustomer && !isBackOffice) {
      return res.status(403).json({
        success: false,
        status: 403,
        message: "You are not allowed to start a support chat.",
      });
    }

    const customerId = isCustomer ? req.user.id : req.body.customer_id;
    if (!customerId) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "customer_id is required.",
      });
    }

    if (!isCustomer && callerType !== USER_TYPE_EMPLOYEE && !req.body.employee_id) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "employee_id is required when starting support chat for a customer.",
      });
    }

    const employeeId = isCustomer
      ? req.body.employee_id
      : callerType === USER_TYPE_EMPLOYEE
        ? req.user.id
        : req.body.employee_id;

    const result = await createOrGetSupportChat({
      customerId,
      employeeId,
      franchiseId: req.body.franchise_id,
      initialMessage: req.body.initial_message,
      actorUserId: req.user.id,
      userType: req.user.type,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(result.created ? 201 : 200).json({
      success: true,
      status: result.created ? 201 : 200,
      message: result.created ? "Support chat created successfully." : "Support chat fetched successfully.",
      record: result.chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const updateChatStatusHandler = async (req, res) => {
  try {
    const chat = await chatService.updateChatStatus(
      req.params.id,
      req.body.status,
      req.user.id,
      req.user.type
    );
    return res.status(200).json({
      success: true,
      status: 200,
      message: "Chat status updated successfully.",
      record: chat,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const getOrderChat = async (req, res) => {
  try {
    const result = await getOrderChatForUser(
      req.params.orderId,
      req.user.id,
      req.user.type
    );

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        status: result.status,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      status: 200,
      message: "Order chat fetched successfully.",
      record: result.chat,
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
  createSupportChat,
  updateChatStatusHandler,
  getOrderChat,
};

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const chatService = require("../services/chat.service");
const messageService = require("../services/message.service");
const readService = require("../services/read.service");
const ChatError = require("../utils/chatError");
const { assertChatAccess } = require("../utils/chatAccess");

const getTokenFromHandshake = (socket) => {
  const authHeader = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization;
  if (!authHeader) return null;
  return String(authHeader).startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
};

const emitSocketError = (socket, error, fallbackMessage) => {
  if (error instanceof ChatError) {
    socket.emit("chat_error", {
      message: error.message,
      code: error.code,
      status: error.status,
    });
    return;
  }
  socket.emit("chat_error", { message: fallbackMessage, code: "CHAT_ERROR", status: 500 });
};

const registerChatSocket = (io) => {
  io.use((socket, next) => {
    try {
      const token = getTokenFromHandshake(socket);
      if (!token) {
        return next(new Error("Authentication token missing."));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      return next();
    } catch (error) {
      return next(new Error("Invalid token."));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.user.id);
    const userType = socket.user.type;
    socket.join(userId);

    socket.on("join_chat", async (chatId) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(chatId)) return;
        await assertChatAccess(chatId, userId, userType);
        socket.join(String(chatId));
      } catch (error) {
        emitSocketError(socket, error, "Unable to join chat.");
      }
    });

    socket.on("leave_chat", (chatId) => {
      socket.leave(String(chatId));
    });

    socket.on("send_message", async (payload = {}) => {
      try {
        if (!payload.chatId || !mongoose.Types.ObjectId.isValid(payload.chatId)) {
          socket.emit("chat_error", { message: "Invalid chatId.", code: "INVALID_CHAT_ID", status: 400 });
          return;
        }
        const message = await messageService.sendMessage(
          {
            chatId: payload.chatId,
            senderId: userId,
            type: payload.type,
            content: payload.content,
            fileUrl: payload.fileUrl,
            metadata: payload.metadata,
          },
          userType
        );
        io.to(String(payload.chatId)).emit("receive_message", message);
      } catch (error) {
        emitSocketError(socket, error, "Unable to send message.");
      }
    });

    socket.on("read_messages", async (payload = {}) => {
      try {
        if (!payload.chatId || !mongoose.Types.ObjectId.isValid(payload.chatId)) {
          return;
        }
        await readService.markAsRead(userId, payload.chatId, userType);
      } catch (error) {
        // Ignore read errors to avoid breaking socket channel.
      }
    });

    socket.on("transfer_chat", async (payload = {}) => {
      try {
        if (!payload.chatId || !payload.newAssignedTo) return;
        const chat = await chatService.transferChat(
          payload.chatId,
          payload.newAssignedTo,
          userId,
          userType
        );
        io.to(String(payload.chatId)).emit("chat_assigned", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        emitSocketError(socket, error, "Unable to transfer chat.");
      }
    });

    socket.on("add_member", async (payload = {}) => {
      try {
        if (!payload.chatId || !Array.isArray(payload.userIds)) return;
        const chat = await chatService.addParticipants(
          payload.chatId,
          payload.userIds,
          userId,
          userType
        );
        io.to(String(payload.chatId)).emit("member_added", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        emitSocketError(socket, error, "Unable to add member.");
      }
    });

    socket.on("remove_member", async (payload = {}) => {
      try {
        if (!payload.chatId || !payload.userId) return;
        const chat = await chatService.removeParticipant(
          payload.chatId,
          payload.userId,
          userId,
          userType
        );
        io.to(String(payload.chatId)).emit("member_removed", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        emitSocketError(socket, error, "Unable to remove member.");
      }
    });
  });
};

module.exports = registerChatSocket;

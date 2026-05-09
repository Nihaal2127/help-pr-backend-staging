const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const chatService = require("../services/chat.service");
const messageService = require("../services/message.service");
const readService = require("../services/read.service");

const getTokenFromHandshake = (socket) => {
  const authHeader = socket.handshake?.auth?.token || socket.handshake?.headers?.authorization;
  if (!authHeader) return null;
  return String(authHeader).startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
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
    socket.join(userId);

    socket.on("join_chat", async (chatId) => {
      if (!mongoose.Types.ObjectId.isValid(chatId)) return;
      socket.join(String(chatId));
    });

    socket.on("leave_chat", (chatId) => {
      socket.leave(String(chatId));
    });

    socket.on("send_message", async (payload = {}) => {
      try {
        if (!payload.chatId || !mongoose.Types.ObjectId.isValid(payload.chatId)) {
          socket.emit("chat_updated", { message: "Invalid chatId." });
          return;
        }
        const message = await messageService.sendMessage({
          chatId: payload.chatId,
          senderId: userId,
          type: payload.type,
          content: payload.content,
          fileUrl: payload.fileUrl,
          metadata: payload.metadata,
        });
        io.to(String(payload.chatId)).emit("receive_message", message);
      } catch (error) {
        socket.emit("chat_updated", { message: "Unable to send message." });
      }
    });

    socket.on("read_messages", async (payload = {}) => {
      try {
        if (!payload.chatId || !mongoose.Types.ObjectId.isValid(payload.chatId)) {
          return;
        }
        await readService.markAsRead(userId, payload.chatId);
      } catch (error) {
        // Ignore read errors to avoid breaking socket channel.
      }
    });

    socket.on("transfer_chat", async (payload = {}) => {
      try {
        if (!payload.chatId || !payload.newAssignedTo) return;
        const chat = await chatService.transferChat(payload.chatId, payload.newAssignedTo);
        io.to(String(payload.chatId)).emit("chat_assigned", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        socket.emit("chat_updated", { message: "Unable to transfer chat." });
      }
    });

    socket.on("add_member", async (payload = {}) => {
      try {
        if (!payload.chatId || !Array.isArray(payload.userIds)) return;
        const chat = await chatService.addParticipants(payload.chatId, payload.userIds);
        io.to(String(payload.chatId)).emit("member_added", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        socket.emit("chat_updated", { message: "Unable to add member." });
      }
    });

    socket.on("remove_member", async (payload = {}) => {
      try {
        if (!payload.chatId || !payload.userId) return;
        const chat = await chatService.removeParticipant(payload.chatId, payload.userId);
        io.to(String(payload.chatId)).emit("member_removed", chat);
        io.to(String(payload.chatId)).emit("chat_updated", chat);
      } catch (error) {
        socket.emit("chat_updated", { message: "Unable to remove member." });
      }
    });
  });
};

module.exports = registerChatSocket;

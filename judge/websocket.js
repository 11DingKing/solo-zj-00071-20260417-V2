const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;
const userConnections = new Map();
const submissionTasks = new Map();

const initWebSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      transports: ["websocket", "polling"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
      
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }
      
      const actualToken = token.replace("Bearer ", "");
      const decoded = jwt.verify(actualToken, process.env.JWT_PRIVATE_KEY || "happycoding");
      
      socket.userId = decoded.sub || decoded.id;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    console.log(`User ${userId} connected with socket: ${socket.id}`);
    
    userConnections.set(userId, socket.id);
    
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: Date.now() });
    });
    
    socket.on("register_submission", (data) => {
      const { submissionId, problemId } = data;
      submissionTasks.set(submissionId, {
        userId: userId,
        problemId: problemId,
        createdAt: Date.now(),
      });
      console.log(`Submission ${submissionId} registered for user ${userId}`);
    });
    
    socket.on("disconnect", (reason) => {
      console.log(`User ${userId} disconnected: ${reason}`);
      
      if (userConnections.get(userId) === socket.id) {
        userConnections.delete(userId);
      }
    });
  });

  return io;
};

const pushToUser = (userId, event, data) => {
  if (!io) {
    console.log("WebSocket not initialized");
    return false;
  }
  
  const socketId = userConnections.get(userId);
  if (socketId) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
      console.log(`Pushed ${event} to user ${userId}`);
      return true;
    }
  }
  console.log(`Failed to push ${event}: user ${userId} not connected`);
  return false;
};

const pushJudgeProgress = (submissionId, status, data = {}) => {
  const task = submissionTasks.get(submissionId);
  if (!task) {
    console.log(`Submission ${submissionId} not found in tasks`);
    return false;
  }
  
  const { userId } = task;
  return pushToUser(userId, "judge_progress", {
    submissionId,
    status,
    ...data,
    timestamp: Date.now(),
  });
};

const pushJudgeResult = (submissionId, verdict, result, testcases) => {
  const task = submissionTasks.get(submissionId);
  if (!task) {
    console.log(`Submission ${submissionId} not found in tasks`);
    return false;
  }
  
  const { userId } = task;
  const success = pushToUser(userId, "judge_result", {
    submissionId,
    verdict,
    result,
    testcases,
    timestamp: Date.now(),
  });
  
  if (success) {
    submissionTasks.delete(submissionId);
  }
  
  return success;
};

module.exports = {
  initWebSocket,
  pushToUser,
  pushJudgeProgress,
  pushJudgeResult,
  submissionTasks,
  userConnections,
};

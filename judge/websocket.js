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
    
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId).add(socket.id);
    
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
      console.log(`Submission ${submissionId} registered for user ${userId} via socket`);
    });
    
    socket.on("disconnect", (reason) => {
      console.log(`User ${userId} disconnected: ${reason}, socket: ${socket.id}`);
      
      const userSockets = userConnections.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          userConnections.delete(userId);
        }
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
  
  const userSockets = userConnections.get(userId);
  if (!userSockets || userSockets.size === 0) {
    console.log(`Failed to push ${event}: user ${userId} not connected`);
    return false;
  }
  
  let pushed = false;
  userSockets.forEach((socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
      console.log(`Pushed ${event} to user ${userId} via socket ${socketId}`);
      pushed = true;
    }
  });
  
  return pushed;
};

const pushJudgeProgress = (submissionId, status, data = {}) => {
  const task = submissionTasks.get(submissionId);
  if (!task) {
    console.log(`Submission ${submissionId} not found in tasks, cannot push progress`);
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

const pushJudgeProgressByUserId = (userId, submissionId, status, data = {}) => {
  if (!submissionTasks.has(submissionId)) {
    submissionTasks.set(submissionId, {
      userId: userId,
      createdAt: Date.now(),
    });
    console.log(`Submission ${submissionId} registered for user ${userId} via API`);
  }
  
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
    console.log(`Submission ${submissionId} not found in tasks, cannot push result`);
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

const pushJudgeResultByUserId = (userId, submissionId, verdict, result, testcases) => {
  if (!submissionTasks.has(submissionId)) {
    submissionTasks.set(submissionId, {
      userId: userId,
      createdAt: Date.now(),
    });
    console.log(`Submission ${submissionId} registered for user ${userId} via API`);
  }
  
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

const registerSubmissionForUser = (userId, submissionId, problemId) => {
  submissionTasks.set(submissionId, {
    userId: userId,
    problemId: problemId,
    createdAt: Date.now(),
  });
  console.log(`Submission ${submissionId} registered for user ${userId}`);
};

module.exports = {
  initWebSocket,
  pushToUser,
  pushJudgeProgress,
  pushJudgeProgressByUserId,
  pushJudgeResult,
  pushJudgeResultByUserId,
  registerSubmissionForUser,
  submissionTasks,
  userConnections,
};

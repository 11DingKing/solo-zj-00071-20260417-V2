import { io } from "socket.io-client";
import { JUDGE_URL } from "./config/config";

const HEARTBEAT_INTERVAL = 30000;
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY = 2000;

class WebSocketManager {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.heartbeatTimer = null;
    this.lastPongTime = Date.now();
    this.eventListeners = new Map();
    this.pendingSubmissions = new Map();
    this.eventHandlers = {};
  }

  cleanupSocket() {
    if (this.socket) {
      if (this.eventHandlers.connect) {
        this.socket.off("connect", this.eventHandlers.connect);
      }
      if (this.eventHandlers.disconnect) {
        this.socket.off("disconnect", this.eventHandlers.disconnect);
      }
      if (this.eventHandlers.connect_error) {
        this.socket.off("connect_error", this.eventHandlers.connect_error);
      }
      if (this.eventHandlers.pong) {
        this.socket.off("pong", this.eventHandlers.pong);
      }
      if (this.eventHandlers.judge_progress) {
        this.socket.off("judge_progress", this.eventHandlers.judge_progress);
      }
      if (this.eventHandlers.judge_result) {
        this.socket.off("judge_result", this.eventHandlers.judge_result);
      }
      
      try {
        this.socket.disconnect();
      } catch (e) {
        console.log("Error disconnecting socket:", e);
      }
      
      this.socket = null;
    }
    this.eventHandlers = {};
  }

  connect() {
    if (this.isConnected) {
      console.log("WebSocket already connected");
      return;
    }

    const token = localStorage.getItem("access-token");
    if (!token) {
      console.log("No token found, skipping WebSocket connection");
      return;
    }

    this.cleanupSocket();

    console.log("Connecting to WebSocket...");

    this.socket = io(JUDGE_URL, {
      auth: {
        token: token,
      },
      transports: ["websocket", "polling"],
      reconnection: false,
    });

    this.eventHandlers.connect = () => {
      console.log("WebSocket connected successfully");
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.startHeartbeat();
      this.emit("connect");

      this.pendingSubmissions.forEach((data, submissionId) => {
        this.registerSubmission(submissionId, data.problemId);
      });
    };
    this.socket.on("connect", this.eventHandlers.connect);

    this.eventHandlers.disconnect = (reason) => {
      console.log("WebSocket disconnected:", reason);
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit("disconnect", reason);

      if (reason === "io server disconnect" || reason === "io client disconnect") {
        console.log("WebSocket intentionally disconnected");
        this.isReconnecting = false;
      } else {
        this.tryReconnect();
      }
    };
    this.socket.on("disconnect", this.eventHandlers.disconnect);

    this.eventHandlers.connect_error = (error) => {
      console.log("WebSocket connection error:", error.message);
      this.isConnected = false;
      this.emit("connect_error", error);
      this.tryReconnect();
    };
    this.socket.on("connect_error", this.eventHandlers.connect_error);

    this.eventHandlers.pong = () => {
      console.log("Received pong from server");
      this.lastPongTime = Date.now();
    };
    this.socket.on("pong", this.eventHandlers.pong);

    this.eventHandlers.judge_progress = (data) => {
      console.log("Received judge progress:", data);
      this.emit("judge_progress", data);
    };
    this.socket.on("judge_progress", this.eventHandlers.judge_progress);

    this.eventHandlers.judge_result = (data) => {
      console.log("Received judge result:", data);
      this.emit("judge_result", data);
      this.pendingSubmissions.delete(data.submissionId);
    };
    this.socket.on("judge_result", this.eventHandlers.judge_result);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
    this.socket = null;
    this.isConnected = false;
    this.stopHeartbeat();
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.lastPongTime = Date.now();

    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected) {
        this.stopHeartbeat();
        return;
      }

      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > HEARTBEAT_INTERVAL * 2) {
        console.log("Heartbeat timeout, reconnecting...");
        this.socket.disconnect();
        this.tryReconnect();
        return;
      }

      console.log("Sending ping to server");
      this.socket.emit("ping");
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  tryReconnect() {
    if (this.isReconnecting) {
      console.log("Already trying to reconnect, skipping");
      return;
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log("Max reconnect attempts reached, giving up");
      this.isReconnecting = false;
      this.emit("reconnect_failed");
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    this.emit("reconnecting", {
      attempt: this.reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS
    });

    setTimeout(() => {
      if (this.isConnected) {
        this.isReconnecting = false;
        return;
      }
      this.connect();
    }, RECONNECT_DELAY * this.reconnectAttempts);
  }

  registerSubmission(submissionId, problemId) {
    if (this.isConnected && this.socket) {
      console.log(`Registering submission ${submissionId} for problem ${problemId}`);
      this.socket.emit("register_submission", {
        submissionId,
        problemId,
      });
      this.pendingSubmissions.set(submissionId, { problemId });
    } else {
      console.log(`Not connected, queuing submission ${submissionId}`);
      this.pendingSubmissions.set(submissionId, { problemId });
    }
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.eventListeners.has(event)) {
      const listeners = this.eventListeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach((callback) => {
      try {
      callback(data);
      } catch (error) {
      console.error(`Error in event listener for ${event}:`, error);
      }
      };
    }
  }
}

const webSocketManager = new WebSocketManager();

export default webSocketManager;

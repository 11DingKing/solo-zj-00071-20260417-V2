const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const morgan = require("morgan");
const cors = require("cors");

const evaluate = require("./routes/evaluate");
const problem = require("./routes/problem");
const { initWebSocket } = require("./websocket");

// Load config
dotenv.config({ path: "./config/config.env" });

const app = express();
const server = http.createServer(app);

// 初始化 WebSocket
const io = initWebSocket(server);

// 导出供其他模块使用
module.exports.io = io;

// Body parser
app.use(express.json({ limit: "50mb" }));
app.use(
  express.urlencoded({ extended: true, limit: "50mb", parameterLimit: 50000 })
);

app.use(cors());

app.use("/api/evaluate", evaluate);
app.use("/api/problem", problem);

if (process.env.NODE_ENV === "development") {
  app.use(morgan("tiny"));
}

const PORT = process.env.PORT || 5000;

server.listen(
  PORT,
  console.log(
    `Judge Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
  )
);

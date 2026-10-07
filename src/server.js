import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { RoomManager } from './services/RoomManager.js';
import { WebSocketHandler } from './services/WebSocketHandler.js';
import { createApiRouter } from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  // Static files for client SDK and Interactive Web Testbench
  app.use(express.static(path.join(projectRoot, 'public')));
  // Also expose SDK directly
  app.use('/sdk', express.static(path.join(__dirname, 'sdk')));

  // Services
  const roomManager = new RoomManager();

  // Routes
  const apiRouter = createApiRouter(roomManager);
  app.use(apiRouter);

  // HTTP Server
  const server = http.createServer(app);

  // WebSocket Server attached to HTTP server
  const wsHandler = new WebSocketHandler(server, roomManager);

  return {
    app,
    server,
    roomManager,
    wsHandler,
    start: (port = config.port, host = config.host) => {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          console.log(`=======================================================`);
          console.log(`🎮 Generic Multiplayer Game Server running!`);
          console.log(`📡 HTTP API:        http://localhost:${port}`);
          console.log(`⚡ WebSocket URI:   ws://localhost:${port}/ws`);
          console.log(`🕹️ Web Test Client: http://localhost:${port}`);
          console.log(`🩺 Health check:    http://localhost:${port}/health`);
          console.log(`=======================================================`);
          resolve({ port, host });
        });
      });
    },
    stop: () => {
      return new Promise((resolve) => {
        clearInterval(wsHandler.heartbeatInterval);
        wsHandler.wss.close(() => {
          server.close(() => {
            resolve();
          });
        });
      });
    },
  };
}

// Auto-start when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.js') || 
  process.argv[1].endsWith('index.js')
);

if (isDirectRun) {
  const serverInstance = createServer();
  serverInstance.start().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

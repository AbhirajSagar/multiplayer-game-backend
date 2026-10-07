import { createServer } from './src/server.js';
export { createServer } from './src/server.js';
export { MultiplayerClient } from './src/sdk/client.js';

const serverInstance = createServer();
serverInstance.start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Heartbeat settings
  pingIntervalMs: parseInt(process.env.PING_INTERVAL_MS || '30000', 10),
  pingTimeoutMs: parseInt(process.env.PING_TIMEOUT_MS || '10000', 10),
  
  // Reconnection grace period (time player has to reconnect before being removed)
  reconnectGracePeriodMs: parseInt(process.env.RECONNECT_GRACE_PERIOD_MS || '30000', 10),
  
  // Inactive empty room cleanup delay
  emptyRoomCleanupMs: parseInt(process.env.EMPTY_ROOM_CLEANUP_MS || '10000', 10),
  
  // Code generation
  roomCodeLength: parseInt(process.env.ROOM_CODE_LENGTH || '6', 10),
  
  // Limits
  defaultMaxPlayers: 4,
  absoluteMaxPlayers: 100,
  maxMessageSizeBytes: 64 * 1024, // 64 KB max payload per message
};

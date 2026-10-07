import { Router } from 'express';
import { config } from '../config.js';

/**
 * Creates API router
 * @param {import('../services/RoomManager.js').RoomManager} roomManager 
 * @returns {Router}
 */
export function createApiRouter(roomManager) {
  const router = Router();
  const startTime = Date.now();

  /**
   * Health check endpoint
   */
  router.get('/health', (req, res) => {
    const stats = roomManager.getStats();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      stats,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Server stats
   */
  router.get('/api/stats', (req, res) => {
    res.json({
      stats: roomManager.getStats(),
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  /**
   * List public rooms with filtering
   * Query params: gameType, hasSlots, isJoinable, search
   */
  router.get('/api/rooms', (req, res) => {
    const { gameType, hasSlots, isJoinable, search } = req.query;

    const rooms = roomManager.listPublicRooms({
      gameType: gameType ? String(gameType) : undefined,
      hasSlots: hasSlots === 'true' || hasSlots === '1',
      isJoinable: isJoinable === 'true' || isJoinable === '1',
      search: search ? String(search) : undefined,
    });

    res.json({
      count: rooms.length,
      rooms,
    });
  });

  /**
   * Get single room details by Room ID or Room Code
   */
  router.get('/api/rooms/:identifier', (req, res) => {
    const room = roomManager.findRoom(req.params.identifier);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      room: room.toPublicJSON(),
    });
  });

  /**
   * Optional REST room creation
   */
  router.post('/api/rooms', (req, res) => {
    try {
      const {
        name,
        gameType,
        isPrivate,
        password,
        maxPlayers,
        allowSpectators,
        customData,
        roomCode,
      } = req.body || {};

      const room = roomManager.createRoom({
        name,
        gameType,
        isPrivate,
        password,
        maxPlayers,
        allowSpectators,
        customData,
        roomCode,
      });

      res.status(201).json({
        room: room.toPublicJSON(),
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

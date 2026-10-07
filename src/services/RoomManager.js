import { Room } from '../models/Room.js';
import { generateRoomCode, normalizeRoomCode } from '../utils/codeGenerator.js';
import { config } from '../config.js';

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.roomsById = new Map();

    /** @type {Map<string, string>} code -> roomId */
    this.roomsByCode = new Map();

    /** @type {Map<string, import('../models/Player.js').Player>} */
    this.playersById = new Map();
  }

  /**
   * Generates a unique room code not currently in use
   * @returns {string}
   */
  generateUniqueCode() {
    let attempts = 0;
    while (attempts < 50) {
      const code = generateRoomCode(config.roomCodeLength);
      if (!this.roomsByCode.has(code)) {
        return code;
      }
      attempts++;
    }
    // Fallback if random short codes collide (extremely rare)
    return generateRoomCode(config.roomCodeLength + 2);
  }

  /**
   * Creates a new room
   * @param {Object} options 
   * @returns {Room}
   */
  createRoom(options = {}) {
    let code = options.roomCode ? normalizeRoomCode(options.roomCode) : null;

    if (code && this.roomsByCode.has(code)) {
      throw new Error(`Room code ${code} is already in use`);
    }

    if (!code) {
      code = this.generateUniqueCode();
    }

    const room = new Room({
      ...options,
      code,
    });

    this.roomsById.set(room.id, room);
    this.roomsByCode.set(room.code, room.id);

    return room;
  }

  /**
   * Get room by ID
   * @param {string} roomId 
   * @returns {Room|undefined}
   */
  getRoomById(roomId) {
    return this.roomsById.get(roomId);
  }

  /**
   * Get room by Code
   * @param {string} code 
   * @returns {Room|undefined}
   */
  getRoomByCode(code) {
    const normalized = normalizeRoomCode(code);
    const roomId = this.roomsByCode.get(normalized);
    if (!roomId) return undefined;
    return this.roomsById.get(roomId);
  }

  /**
   * Find room by either ID or Code
   * @param {string} identifier 
   * @returns {Room|undefined}
   */
  findRoom(identifier) {
    if (!identifier) return undefined;
    return this.getRoomById(identifier) || this.getRoomByCode(identifier);
  }

  /**
   * Delete room and cleanup indices
   * @param {string} roomId 
   * @returns {boolean}
   */
  deleteRoom(roomId) {
    const room = this.roomsById.get(roomId);
    if (!room) return false;

    room.clearCleanupTimer();
    this.roomsByCode.delete(room.code);
    this.roomsById.delete(roomId);
    return true;
  }

  /**
   * Register a player in the global registry
   * @param {import('../models/Player.js').Player} player 
   */
  registerPlayer(player) {
    this.playersById.set(player.id, player);
  }

  /**
   * Unregister a player
   * @param {string} playerId 
   */
  unregisterPlayer(playerId) {
    this.playersById.delete(playerId);
  }

  /**
   * Get a player by ID
   * @param {string} playerId 
   * @returns {import('../models/Player.js').Player|undefined}
   */
  getPlayer(playerId) {
    return this.playersById.get(playerId);
  }

  /**
   * List public rooms with optional filtering
   * @param {Object} [filter]
   * @param {string} [filter.gameType]
   * @param {boolean} [filter.hasSlots]
   * @param {boolean} [filter.isJoinable]
   * @param {string} [filter.search]
   * @returns {Array<Object>}
   */
  listPublicRooms({ gameType, hasSlots, isJoinable, search } = {}) {
    const publicRooms = [];

    for (const room of this.roomsById.values()) {
      if (room.isPrivate) continue;

      if (gameType && room.gameType.toLowerCase() !== gameType.toLowerCase()) {
        continue;
      }

      if (hasSlots && room.isFull()) {
        continue;
      }

      if (isJoinable && !room.isJoinable()) {
        continue;
      }

      if (search) {
        const query = search.toLowerCase();
        const matchesName = room.name.toLowerCase().includes(query);
        const matchesCode = room.code.toLowerCase().includes(query);
        const matchesGame = room.gameType.toLowerCase().includes(query);
        if (!matchesName && !matchesCode && !matchesGame) {
          continue;
        }
      }

      publicRooms.push(room.toPublicJSON());
    }

    // Sort by created descending
    publicRooms.sort((a, b) => b.createdAt - a.createdAt);
    return publicRooms;
  }

  /**
   * Find an available public room matching gameType, or null
   * @param {Object} [criteria]
   * @returns {Room|null}
   */
  quickMatch({ gameType = 'generic' } = {}) {
    for (const room of this.roomsById.values()) {
      if (
        !room.isPrivate &&
        !room.hasPassword() &&
        room.isJoinable() &&
        room.gameType.toLowerCase() === gameType.toLowerCase()
      ) {
        return room;
      }
    }
    return null;
  }

  /**
   * Get server-wide summary statistics
   */
  getStats() {
    let totalPlayers = 0;
    let activePlayers = 0;
    let playingRooms = 0;
    let lobbyRooms = 0;

    for (const room of this.roomsById.values()) {
      totalPlayers += room.totalMemberCount();
      activePlayers += room.activePlayerCount();
      if (room.status === 'playing') playingRooms++;
      else lobbyRooms++;
    }

    return {
      totalRooms: this.roomsById.size,
      lobbyRooms,
      playingRooms,
      totalPlayers,
      activePlayers,
    };
  }
}

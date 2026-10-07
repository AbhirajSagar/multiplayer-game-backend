import crypto from 'crypto';
import { RoomStatus, PlayerRole, MessageTypes } from '../constants/protocol.js';

export class Room {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {string} options.code
   * @param {string} [options.name]
   * @param {string} [options.gameType]
   * @param {boolean} [options.isPrivate]
   * @param {string} [options.password]
   * @param {number} [options.maxPlayers]
   * @param {boolean} [options.allowSpectators]
   * @param {Object} [options.customData]
   * @param {Object} [options.initialState]
   * @param {string} [options.hostId]
   */
  constructor({
    id = `rm_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    code,
    name = 'Game Lobby',
    gameType = 'generic',
    isPrivate = false,
    password = null,
    maxPlayers = 4,
    allowSpectators = true,
    customData = {},
    initialState = {},
    hostId = null,
  }) {
    this.id = id;
    this.code = code;
    this.name = name;
    this.gameType = gameType;
    this.isPrivate = Boolean(isPrivate);
    this.password = password ? String(password) : null;
    this.maxPlayers = Math.max(1, Math.min(maxPlayers, 100));
    this.allowSpectators = Boolean(allowSpectators);
    this.isLocked = false;
    this.status = RoomStatus.LOBBY;
    this.hostId = hostId;
    
    /** @type {Map<string, import('./Player.js').Player>} */
    this.players = new Map();
    
    /** @type {Map<string, import('./Player.js').Player>} */
    this.spectators = new Map();
    
    // Client-controlled shared room state (e.g. board, round, turn, scores)
    this.state = typeof initialState === 'object' && initialState !== null ? { ...initialState } : {};
    
    // Client-controlled room metadata (e.g. mapName, difficulty, customRules)
    this.customData = typeof customData === 'object' && customData !== null ? { ...customData } : {};
    
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.cleanupTimer = null;
  }

  /**
   * Check if room has a password
   * @returns {boolean}
   */
  hasPassword() {
    return Boolean(this.password && this.password.length > 0);
  }

  /**
   * Verify password provided by joining player
   * @param {string} password 
   * @returns {boolean}
   */
  verifyPassword(password) {
    if (!this.hasPassword()) return true;
    return this.password === String(password || '');
  }

  /**
   * Number of players (excluding spectators)
   */
  playerCount() {
    return this.players.size;
  }

  /**
   * Number of active (connected) players
   */
  activePlayerCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.status === 'active') count++;
    }
    return count;
  }

  /**
   * Total members (players + spectators)
   */
  totalMemberCount() {
    return this.players.size + this.spectators.size;
  }

  /**
   * Check if player capacity has been reached
   */
  isFull() {
    return this.players.size >= this.maxPlayers;
  }

  /**
   * Check if new players can join
   */
  isJoinable() {
    return !this.isLocked && !this.isFull() && this.status !== RoomStatus.ENDED;
  }

  /**
   * Add a player or spectator
   * @param {import('./Player.js').Player} player 
   * @param {boolean} asSpectator 
   */
  addMember(player, asSpectator = false) {
    player.currentRoomId = this.id;

    if (asSpectator && this.allowSpectators) {
      player.role = PlayerRole.SPECTATOR;
      this.spectators.set(player.id, player);
    } else {
      // First member becomes host if no host yet
      if (this.players.size === 0 && !this.hostId) {
        player.role = PlayerRole.HOST;
        this.hostId = player.id;
      } else {
        player.role = PlayerRole.PLAYER;
      }
      this.players.set(player.id, player);
    }

    this.updatedAt = Date.now();
    this.clearCleanupTimer();
  }

  /**
   * Remove member by playerId
   * @param {string} playerId 
   * @returns {import('./Player.js').Player|null}
   */
  removeMember(playerId) {
    let removed = null;

    if (this.players.has(playerId)) {
      removed = this.players.get(playerId);
      this.players.delete(playerId);
      
      // If host left, migrate host to next active player
      if (this.hostId === playerId) {
        this.migrateHost();
      }
    } else if (this.spectators.has(playerId)) {
      removed = this.spectators.get(playerId);
      this.spectators.delete(playerId);
    }

    if (removed) {
      removed.currentRoomId = null;
      this.updatedAt = Date.now();
    }

    return removed;
  }

  /**
   * Migrate host to another player
   * @param {string} [candidateId] 
   * @returns {import('./Player.js').Player|null}
   */
  migrateHost(candidateId = null) {
    if (candidateId && this.players.has(candidateId)) {
      const newHost = this.players.get(candidateId);
      newHost.role = PlayerRole.HOST;
      this.hostId = newHost.id;
      return newHost;
    }

    // Otherwise, pick the first active player, or any player
    let newHost = null;
    for (const player of this.players.values()) {
      if (player.status === 'active') {
        newHost = player;
        break;
      }
    }

    if (!newHost && this.players.size > 0) {
      newHost = this.players.values().next().value;
    }

    if (newHost) {
      newHost.role = PlayerRole.HOST;
      this.hostId = newHost.id;
    } else {
      this.hostId = null;
    }

    return newHost;
  }

  /**
   * Get a player or spectator by ID
   * @param {string} playerId 
   * @returns {import('./Player.js').Player|undefined}
   */
  getMember(playerId) {
    return this.players.get(playerId) || this.spectators.get(playerId);
  }

  /**
   * Updates shared room state with a patch
   * @param {Object} patch 
   * @returns {Object}
   */
  updateSharedState(patch) {
    if (typeof patch === 'object' && patch !== null) {
      this.state = {
        ...this.state,
        ...patch,
      };
      this.updatedAt = Date.now();
    }
    return this.state;
  }

  /**
   * Broadcast message to room members
   * @param {Object} message 
   * @param {string|null} [excludePlayerId] 
   * @param {boolean} [spectatorsToo]
   */
  broadcast(message, excludePlayerId = null, spectatorsToo = true) {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);

    for (const [id, player] of this.players.entries()) {
      if (id !== excludePlayerId) {
        player.send(serialized);
      }
    }

    if (spectatorsToo) {
      for (const [id, spectator] of this.spectators.entries()) {
        if (id !== excludePlayerId) {
          spectator.send(serialized);
        }
      }
    }
  }

  /**
   * Send a message to a specific player
   * @param {string} targetPlayerId 
   * @param {Object} message 
   * @returns {boolean}
   */
  sendTo(targetPlayerId, message) {
    const member = this.getMember(targetPlayerId);
    if (member) {
      member.send(message);
      return true;
    }
    return false;
  }

  /**
   * Start cleanup timer for empty room
   * @param {Function} onCleanup 
   * @param {number} delayMs 
   */
  scheduleCleanup(onCleanup, delayMs = 10000) {
    this.clearCleanupTimer();
    this.cleanupTimer = setTimeout(() => {
      onCleanup(this.id);
    }, delayMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Clear pending cleanup timer
   */
  clearCleanupTimer() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Serializes room for public listing (omits passwords, sensitive data)
   */
  toPublicJSON() {
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      gameType: this.gameType,
      isPrivate: this.isPrivate,
      hasPassword: this.hasPassword(),
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      spectatorCount: this.spectators.size,
      status: this.status,
      isLocked: this.isLocked,
      isJoinable: this.isJoinable(),
      customData: this.customData,
      createdAt: this.createdAt,
    };
  }

  /**
   * Serializes full room for connected players
   * @param {string} [viewerPlayerId]
   */
  toFullJSON(viewerPlayerId = null) {
    const playersList = Array.from(this.players.values()).map(p => 
      p.toJSON(p.id === viewerPlayerId)
    );
    const spectatorsList = Array.from(this.spectators.values()).map(s => 
      s.toJSON(s.id === viewerPlayerId)
    );

    return {
      id: this.id,
      code: this.code,
      name: this.name,
      gameType: this.gameType,
      isPrivate: this.isPrivate,
      hasPassword: this.hasPassword(),
      maxPlayers: this.maxPlayers,
      allowSpectators: this.allowSpectators,
      status: this.status,
      isLocked: this.isLocked,
      hostId: this.hostId,
      customData: this.customData,
      state: this.state,
      players: playersList,
      spectators: spectatorsList,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

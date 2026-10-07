/**
 * Universal Multiplayer Game Client SDK
 * Works in Browser and Node.js environments
 */

export class MultiplayerClient {
  /**
   * @param {Object} options
   * @param {string} [options.url] WebSocket URL e.g. 'ws://localhost:3000/ws'
   * @param {any} [options.WebSocketClass] Custom WebSocket implementation (e.g. `ws` for Node.js)
   * @param {boolean} [options.autoReconnect] Attempt auto reconnect on disconnect
   */
  constructor({
    url = (typeof window !== 'undefined' 
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      : 'ws://localhost:3000/ws'),
    WebSocketClass = (typeof WebSocket !== 'undefined' ? WebSocket : null),
    autoReconnect = true,
  } = {}) {
    this.url = url;
    this.WebSocketClass = WebSocketClass;
    this.autoReconnect = autoReconnect;
    
    this.ws = null;
    this.listeners = new Map();
    this.pendingRequests = new Map();
    
    // Session state
    this.playerId = null;
    this.reconnectToken = null;
    this.room = null;
    this.isConnected = false;
    
    this._reqCounter = 0;
  }

  /**
   * Register event listener
   * @param {string} event 
   * @param {Function} callback 
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove event listener
   * @param {string} event 
   * @param {Function} callback 
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Emit internal event
   * @param {string} event 
   * @param  {...any} args 
   */
  emit(event, ...args) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[MultiplayerClient] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Connect to server
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      const WS = this.WebSocketClass || (typeof WebSocket !== 'undefined' ? WebSocket : null);
      if (!WS) {
        return reject(new Error('No WebSocket implementation found. In Node.js, pass WebSocketClass: import("ws")'));
      }

      try {
        this.ws = new WS(this.url);
      } catch (err) {
        return reject(err);
      }

      let opened = false;

      this.ws.onopen = () => {
        opened = true;
        this.isConnected = true;
        this.emit('connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.emit('disconnected', { code: event.code, reason: event.reason, wasConnected });

        // Reject pending requests
        for (const [reqId, { reject }] of this.pendingRequests.entries()) {
          reject(new Error('Connection closed before response received'));
        }
        this.pendingRequests.clear();
      };

      this.ws.onerror = (err) => {
        if (!opened) {
          reject(err);
        }
        this.emit('error', err);
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };
    });
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * Send a raw message with Promise-based response correlation
   * @param {string} type 
   * @param {Object} [payload] 
   * @param {number} [timeoutMs] 
   * @returns {Promise<any>}
   */
  request(type, payload = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        return reject(new Error('WebSocket is not connected'));
      }

      const requestId = `req_${++this._reqCounter}_${Date.now()}`;
      
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timed out after ${timeoutMs}ms for ${type}`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const msg = {
        type,
        payload,
        requestId,
      };

      this.ws.send(JSON.stringify(msg));
    });
  }

  /**
   * Fire-and-forget message send
   * @param {string} type 
   * @param {Object} [payload] 
   */
  send(type, payload = {}) {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Handle incoming socket messages
   * @private
   */
  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const { type, payload, requestId, error } = msg;

    // Handle correlated request promises
    if (requestId && this.pendingRequests.has(requestId)) {
      const { resolve, reject, timer } = this.pendingRequests.get(requestId);
      clearTimeout(timer);
      this.pendingRequests.delete(requestId);

      if (type === 'ERROR' || error) {
        return reject(new Error(error?.message || 'Server error'));
      }
      return resolve(payload);
    }

    // Process push events
    switch (type) {
      case 'ROOM_CREATED':
      case 'ROOM_JOINED':
        this.room = payload.room;
        this.playerId = payload.player.id;
        this.reconnectToken = payload.player.reconnectToken;
        this.emit(type === 'ROOM_CREATED' ? 'roomCreated' : 'roomJoined', payload);
        break;

      case 'ROOM_LEFT':
        this.room = null;
        this.emit('roomLeft');
        break;

      case 'PLAYER_JOINED':
        if (this.room) {
          if (payload.player.role === 'spectator') {
            this.room.spectators = this.room.spectators || [];
            this.room.spectators.push(payload.player);
          } else {
            this.room.players = this.room.players || [];
            this.room.players.push(payload.player);
          }
        }
        this.emit('playerJoined', payload.player);
        break;

      case 'PLAYER_LEFT':
        if (this.room) {
          this.room.players = (this.room.players || []).filter(p => p.id !== payload.playerId);
          this.room.spectators = (this.room.spectators || []).filter(s => s.id !== payload.playerId);
          if (payload.newHostId) {
            this.room.hostId = payload.newHostId;
          }
        }
        this.emit('playerLeft', payload);
        break;

      case 'PLAYER_DISCONNECTED':
        if (this.room) {
          const player = (this.room.players || []).find(p => p.id === payload.playerId);
          if (player) player.isDisconnected = true;
        }
        this.emit('playerDisconnected', payload);
        break;

      case 'PLAYER_RECONNECTED':
        if (this.room) {
          const player = (this.room.players || []).find(p => p.id === payload.playerId);
          if (player) player.isDisconnected = false;
        }
        this.emit('playerReconnected', payload);
        break;

      case 'PLAYER_KICKED':
        this.room = null;
        this.emit('kicked', payload.reason);
        break;

      case 'PLAYER_READY_CHANGED':
        if (this.room) {
          const player = (this.room.players || []).find(p => p.id === payload.playerId);
          if (player) player.ready = payload.ready;
        }
        this.emit('playerReadyChanged', payload);
        break;

      case 'HOST_CHANGED':
        if (this.room) {
          this.room.hostId = payload.newHostId;
        }
        this.emit('hostChanged', payload);
        break;

      case 'ROOM_SETTINGS_UPDATED':
        if (this.room) {
          Object.assign(this.room, payload);
        }
        this.emit('roomSettingsUpdated', payload);
        break;

      case 'GAME_STARTED':
        if (this.room) {
          this.room.status = payload.status;
          this.room.isLocked = payload.isLocked;
        }
        this.emit('gameStarted', payload);
        break;

      case 'GAME_ENDED':
        if (this.room) {
          this.room.status = payload.status;
        }
        this.emit('gameEnded', payload);
        break;

      case 'ROOM_LOCKED':
        if (this.room) {
          this.room.isLocked = payload.isLocked;
        }
        this.emit('roomLocked', payload);
        break;

      case 'ROOM_STATE_UPDATED':
        if (this.room) {
          this.room.state = payload.state;
        }
        this.emit('roomStateUpdated', payload);
        break;

      case 'PLAYER_STATE_UPDATED':
        if (this.room) {
          const player = (this.room.players || []).find(p => p.id === payload.playerId);
          if (player) {
            player.state = payload.state;
          }
        }
        this.emit('playerStateUpdated', payload);
        break;

      case 'RELAY_MESSAGE':
        this.emit('relay', payload.event, payload.data, payload.senderId, payload);
        // Also emit event-specific listener e.g. client.on('relay:PLAYER_MOVED', ...)
        this.emit(`relay:${payload.event}`, payload.data, payload.senderId, payload);
        break;

      case 'ERROR':
        this.emit('error', error);
        break;
    }
  }

  // --- High-Level Lobby & Room API ---

  /**
   * Create a new room
   * @param {Object} options 
   * @returns {Promise<{ room: Object, player: Object }>}
   */
  async createRoom(options = {}) {
    const res = await this.request('CREATE_ROOM', options);
    this.room = res.room;
    this.playerId = res.player.id;
    this.reconnectToken = res.player.reconnectToken;
    return res;
  }

  /**
   * Join an existing room by code or ID
   * @param {Object} options 
   * @returns {Promise<{ room: Object, player: Object }>}
   */
  async joinRoom(options = {}) {
    const res = await this.request('JOIN_ROOM', options);
    this.room = res.room;
    this.playerId = res.player.id;
    this.reconnectToken = res.player.reconnectToken;
    return res;
  }

  /**
   * Quick join public match
   * @param {Object} options 
   * @returns {Promise<{ room: Object, player: Object }>}
   */
  async quickJoin(options = {}) {
    const res = await this.request('QUICK_JOIN', options);
    this.room = res.room;
    this.playerId = res.player.id;
    this.reconnectToken = res.player.reconnectToken;
    return res;
  }

  /**
   * Reconnect to previous session using reconnectToken
   * @param {string} roomId 
   * @param {string} playerId 
   * @param {string} reconnectToken 
   */
  async reconnect(roomId, playerId, reconnectToken) {
    const res = await this.request('RECONNECT', {
      roomId,
      playerId,
      reconnectToken,
    });
    this.room = res.room;
    this.playerId = res.player.id;
    this.reconnectToken = res.player.reconnectToken;
    return res;
  }

  /**
   * Leave the current room
   */
  async leaveRoom() {
    const res = await this.request('LEAVE_ROOM');
    this.room = null;
    return res;
  }

  /**
   * Mark ready state
   * @param {boolean} ready 
   */
  async setReady(ready = true) {
    return this.request('SET_READY', { ready });
  }

  // --- Client-Controlled State & Relay API ---

  /**
   * Patch shared room state
   * @param {Object} patch 
   */
  async updateRoomState(patch) {
    return this.request('UPDATE_ROOM_STATE', { patch });
  }

  /**
   * Patch client's own player state
   * @param {Object} patch 
   */
  async updatePlayerState(patch) {
    return this.request('UPDATE_PLAYER_STATE', { patch });
  }

  /**
   * Relay arbitrary event & data to room members
   * @param {string} event Custom event name (e.g. 'MOVE', 'CHAT', 'ROLL_DICE')
   * @param {any} data Any payload (JSON serializable)
   * @param {string} [target] 'others' (default), 'all', 'host', or a specific playerId
   */
  relay(event, data, target = 'others') {
    this.send('RELAY', { event, data, target });
  }

  // --- Host Only Actions ---

  /**
   * Start the game (Host only)
   * @param {Object} [options]
   */
  async startGame(options = {}) {
    return this.request('START_GAME', options);
  }

  /**
   * End the game (Host only)
   * @param {Object} [options]
   */
  async endGame(options = {}) {
    return this.request('END_GAME', options);
  }

  /**
   * Lock room to new joins (Host only)
   */
  async lockRoom() {
    return this.request('LOCK_ROOM');
  }

  /**
   * Unlock room (Host only)
   */
  async unlockRoom() {
    return this.request('UNLOCK_ROOM');
  }

  /**
   * Kick player from room (Host only)
   * @param {string} playerId 
   * @param {string} [reason] 
   */
  async kickPlayer(playerId, reason) {
    return this.request('KICK_PLAYER', { playerId, reason });
  }

  /**
   * Transfer host to another player (Host only)
   * @param {string} playerId 
   */
  async transferHost(playerId) {
    return this.request('TRANSFER_HOST', { playerId });
  }

  /**
   * Update room settings (Host only)
   * @param {Object} settings 
   */
  async updateRoomSettings(settings) {
    return this.request('UPDATE_ROOM_SETTINGS', settings);
  }

  /**
   * Ping server
   */
  async ping() {
    return this.request('PING', { timestamp: Date.now() });
  }
}

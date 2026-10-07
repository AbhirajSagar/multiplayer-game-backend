import { WebSocketServer } from 'ws';
import { Player } from '../models/Player.js';
import { MessageTypes, RoomStatus, PlayerRole, PlayerStatus, ErrorCodes } from '../constants/protocol.js';
import { config } from '../config.js';

export class WebSocketHandler {
  /**
   * @param {import('http').Server} httpServer 
   * @param {import('./RoomManager.js').RoomManager} roomManager 
   */
  constructor(httpServer, roomManager) {
    this.roomManager = roomManager;
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      maxPayload: config.maxMessageSizeBytes,
    });

    this.setupHeartbeat();
    this.setupConnectionListener();
  }

  /**
   * Periodic ping/pong check to detect dead sockets
   */
  setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (ws.isAlive === false) {
          console.log('[WS] Terminating unresponsive connection');
          ws.terminate();
          continue;
        }

        ws.isAlive = false;
        ws.ping();
      }
    }, config.pingIntervalMs);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }

    this.wss.on('close', () => {
      clearInterval(this.heartbeatInterval);
    });
  }

  /**
   * Set up incoming WebSocket connection handling
   */
  setupConnectionListener() {
    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      ws.player = null; // Will be set when player joins/creates or reconnects

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        this.handleMessage(ws, raw);
      });

      ws.on('close', (code, reason) => {
        this.handleClose(ws);
      });

      ws.on('error', (err) => {
        console.error('[WS] Socket error:', err.message);
      });
    });
  }

  /**
   * Safe JSON send helper
   * @param {import('ws').WebSocket} ws 
   * @param {Object} message 
   */
  send(ws, message) {
    if (ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(JSON.stringify(message));
      } catch (err) {
        console.error('[WS] Send failed:', err.message);
      }
    }
  }

  /**
   * Send error response to socket
   * @param {import('ws').WebSocket} ws 
   * @param {string} code 
   * @param {string} message 
   * @param {string} [requestId] 
   */
  sendError(ws, code, message, requestId = null) {
    this.send(ws, {
      type: MessageTypes.ERROR,
      requestId,
      error: { code, message },
    });
  }

  /**
   * Send success response with optional requestId
   * @param {import('ws').WebSocket} ws 
   * @param {string} type 
   * @param {Object} payload 
   * @param {string} [requestId] 
   */
  sendResponse(ws, type, payload, requestId = null) {
    this.send(ws, {
      type,
      requestId,
      payload,
    });
  }

  /**
   * Parse and route incoming client messages
   * @param {import('ws').WebSocket} ws 
   * @param {Buffer|string} raw 
   */
  handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'Invalid JSON payload');
    }

    const { type, payload = {}, requestId } = msg;

    if (!type) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'Message type is required', requestId);
    }

    try {
      switch (type) {
        case MessageTypes.PING:
          this.handlePing(ws, payload, requestId);
          break;

        case MessageTypes.CREATE_ROOM:
          this.handleCreateRoom(ws, payload, requestId);
          break;

        case MessageTypes.JOIN_ROOM:
          this.handleJoinRoom(ws, payload, requestId);
          break;

        case MessageTypes.QUICK_JOIN:
          this.handleQuickJoin(ws, payload, requestId);
          break;

        case MessageTypes.RECONNECT:
          this.handleReconnect(ws, payload, requestId);
          break;

        case MessageTypes.LEAVE_ROOM:
          this.handleLeaveRoom(ws, payload, requestId);
          break;

        case MessageTypes.SET_READY:
          this.handleSetReady(ws, payload, requestId);
          break;

        case MessageTypes.START_GAME:
          this.handleStartGame(ws, payload, requestId);
          break;

        case MessageTypes.END_GAME:
          this.handleEndGame(ws, payload, requestId);
          break;

        case MessageTypes.LOCK_ROOM:
          this.handleLockRoom(ws, payload, requestId);
          break;

        case MessageTypes.UNLOCK_ROOM:
          this.handleUnlockRoom(ws, payload, requestId);
          break;

        case MessageTypes.KICK_PLAYER:
          this.handleKickPlayer(ws, payload, requestId);
          break;

        case MessageTypes.TRANSFER_HOST:
          this.handleTransferHost(ws, payload, requestId);
          break;

        case MessageTypes.UPDATE_ROOM_SETTINGS:
          this.handleUpdateRoomSettings(ws, payload, requestId);
          break;

        case MessageTypes.UPDATE_ROOM_STATE:
          this.handleUpdateRoomState(ws, payload, requestId);
          break;

        case MessageTypes.UPDATE_PLAYER_STATE:
          this.handleUpdatePlayerState(ws, payload, requestId);
          break;

        case MessageTypes.RELAY:
          this.handleRelay(ws, payload, requestId);
          break;

        default:
          this.sendError(ws, ErrorCodes.UNKNOWN_MESSAGE_TYPE, `Unknown message type: ${type}`, requestId);
      }
    } catch (err) {
      console.error(`[WS] Error processing message ${type}:`, err);
      this.sendError(ws, ErrorCodes.INTERNAL_ERROR, err.message, requestId);
    }
  }

  /**
   * Ping / Pong keepalive
   */
  handlePing(ws, payload, requestId) {
    this.sendResponse(ws, MessageTypes.PONG, {
      timestamp: Date.now(),
      clientTimestamp: payload?.timestamp,
    }, requestId);
  }

  /**
   * CREATE_ROOM handler
   */
  handleCreateRoom(ws, payload, requestId) {
    const {
      name,
      gameType = 'generic',
      isPrivate = false,
      password,
      maxPlayers = config.defaultMaxPlayers,
      allowSpectators = true,
      customData = {},
      initialState = {},
      roomCode,
      player: playerData = {},
    } = payload;

    // If player already in a room, leave it first
    if (ws.player && ws.player.currentRoomId) {
      this.cleanlyLeaveCurrentRoom(ws.player);
    }

    let room;
    try {
      room = this.roomManager.createRoom({
        name: name || `${playerData.name || 'Player'}'s Room`,
        gameType,
        isPrivate: Boolean(isPrivate),
        password: password || null,
        maxPlayers: Number(maxPlayers) || config.defaultMaxPlayers,
        allowSpectators: allowSpectators !== false,
        customData,
        initialState,
        roomCode,
      });
    } catch (err) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, err.message, requestId);
    }

    const player = new Player({
      ws,
      name: playerData.name || 'Host',
      role: PlayerRole.HOST,
      customData: playerData.customData || {},
      state: playerData.state || {},
    });

    this.roomManager.registerPlayer(player);
    room.addMember(player, false);
    ws.player = player;

    this.sendResponse(ws, MessageTypes.ROOM_CREATED, {
      room: room.toFullJSON(player.id),
      player: player.toJSON(true), // Includes secret reconnectToken
    }, requestId);
  }

  /**
   * JOIN_ROOM handler
   */
  handleJoinRoom(ws, payload, requestId) {
    const {
      roomId,
      roomCode,
      password,
      asSpectator = false,
      player: playerData = {},
    } = payload;

    const identifier = roomId || roomCode;
    if (!identifier) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'Room ID or Room Code is required', requestId);
    }

    const room = this.roomManager.findRoom(identifier);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    if (!room.verifyPassword(password)) {
      return this.sendError(ws, ErrorCodes.INVALID_PASSWORD, 'Incorrect room password', requestId);
    }

    const willSpectate = Boolean(asSpectator);

    if (!willSpectate) {
      if (room.isLocked) {
        return this.sendError(ws, ErrorCodes.ROOM_LOCKED, 'Room is currently locked', requestId);
      }
      if (room.isFull()) {
        return this.sendError(ws, ErrorCodes.ROOM_FULL, 'Room is at maximum player capacity', requestId);
      }
    } else {
      if (!room.allowSpectators) {
        return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Spectators are not allowed in this room', requestId);
      }
    }

    // Leave previous room if any
    if (ws.player && ws.player.currentRoomId) {
      this.cleanlyLeaveCurrentRoom(ws.player);
    }

    const player = new Player({
      ws,
      name: playerData.name || (willSpectate ? 'Spectator' : 'Player'),
      role: willSpectate ? PlayerRole.SPECTATOR : PlayerRole.PLAYER,
      customData: playerData.customData || {},
      state: playerData.state || {},
    });

    this.roomManager.registerPlayer(player);
    room.addMember(player, willSpectate);
    ws.player = player;

    // Send complete room snapshot to the joining player
    this.sendResponse(ws, MessageTypes.ROOM_JOINED, {
      room: room.toFullJSON(player.id),
      player: player.toJSON(true), // Secret reconnect token included for this client
    }, requestId);

    // Notify all other members
    room.broadcast({
      type: MessageTypes.PLAYER_JOINED,
      payload: {
        player: player.toJSON(false),
      },
    }, player.id);
  }

  /**
   * QUICK_JOIN handler: joins available public room or optionally creates one
   */
  handleQuickJoin(ws, payload, requestId) {
    const {
      gameType = 'generic',
      createIfNotFound = true,
      roomOptions = {},
      player: playerData = {},
    } = payload;

    const matchedRoom = this.roomManager.quickMatch({ gameType });

    if (matchedRoom) {
      return this.handleJoinRoom(ws, {
        roomId: matchedRoom.id,
        player: playerData,
      }, requestId);
    }

    if (createIfNotFound) {
      return this.handleCreateRoom(ws, {
        gameType,
        isPrivate: false,
        name: roomOptions.name || `Public ${gameType} Room`,
        maxPlayers: roomOptions.maxPlayers || config.defaultMaxPlayers,
        customData: roomOptions.customData || {},
        player: playerData,
      }, requestId);
    }

    this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'No available public rooms found', requestId);
  }

  /**
   * RECONNECT handler: resume player session after disconnect
   */
  handleReconnect(ws, payload, requestId) {
    const { roomId, playerId, reconnectToken } = payload;

    if (!roomId || !playerId || !reconnectToken) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'roomId, playerId and reconnectToken are required', requestId);
    }

    const room = this.roomManager.findRoom(roomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found or expired', requestId);
    }

    const player = room.getMember(playerId);
    if (!player) {
      return this.sendError(ws, ErrorCodes.PLAYER_NOT_FOUND, 'Player not found in room', requestId);
    }

    if (player.reconnectToken !== reconnectToken) {
      return this.sendError(ws, ErrorCodes.INVALID_RECONNECT_TOKEN, 'Invalid reconnect token', requestId);
    }

    // Attach socket and resume
    player.attachSocket(ws);
    ws.player = player;

    // Send complete current room state to reconnected player
    this.sendResponse(ws, MessageTypes.ROOM_JOINED, {
      room: room.toFullJSON(player.id),
      player: player.toJSON(true),
      reconnected: true,
    }, requestId);

    // Notify other players
    room.broadcast({
      type: MessageTypes.PLAYER_RECONNECTED,
      payload: {
        playerId: player.id,
        player: player.toJSON(false),
      },
    }, player.id);
  }

  /**
   * LEAVE_ROOM handler
   */
  handleLeaveRoom(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'You are not in a room', requestId);
    }

    this.cleanlyLeaveCurrentRoom(player);
    ws.player = null;

    this.sendResponse(ws, MessageTypes.ROOM_LEFT, {
      success: true,
    }, requestId);
  }

  /**
   * Helper: removes player from their current room and notifies others
   */
  cleanlyLeaveCurrentRoom(player) {
    const roomId = player.currentRoomId;
    if (!roomId) return;

    const room = this.roomManager.getRoomById(roomId);
    if (!room) return;

    const previousRole = player.role;
    room.removeMember(player.id);
    this.roomManager.unregisterPlayer(player.id);

    // If host left, room automatically migrated host
    const newHostId = room.hostId;

    room.broadcast({
      type: MessageTypes.PLAYER_LEFT,
      payload: {
        playerId: player.id,
        newHostId: previousRole === PlayerRole.HOST ? newHostId : undefined,
      },
    });

    if (previousRole === PlayerRole.HOST && newHostId) {
      room.broadcast({
        type: MessageTypes.HOST_CHANGED,
        payload: {
          newHostId,
          previousHostId: player.id,
        },
      });
    }

    // If room is now empty, schedule cleanup
    if (room.totalMemberCount() === 0) {
      room.scheduleCleanup((id) => {
        this.roomManager.deleteRoom(id);
      }, config.emptyRoomCleanupMs);
    }
  }

  /**
   * SET_READY handler
   */
  handleSetReady(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    player.ready = Boolean(payload.ready);

    room.broadcast({
      type: MessageTypes.PLAYER_READY_CHANGED,
      payload: {
        playerId: player.id,
        ready: player.ready,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { ready: player.ready }, requestId);
  }

  /**
   * START_GAME handler (Host only)
   */
  handleStartGame(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    if (room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only the host can start the game', requestId);
    }

    room.status = RoomStatus.PLAYING;
    if (payload.lockRoom) {
      room.isLocked = true;
    }

    room.broadcast({
      type: MessageTypes.GAME_STARTED,
      payload: {
        status: room.status,
        isLocked: room.isLocked,
        customData: payload.customData || {},
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { status: room.status }, requestId);
  }

  /**
   * END_GAME handler (Host only)
   */
  handleEndGame(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can end game', requestId);
    }

    room.status = RoomStatus.ENDED;

    room.broadcast({
      type: MessageTypes.GAME_ENDED,
      payload: {
        status: room.status,
        customData: payload.customData || {},
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { status: room.status }, requestId);
  }

  /**
   * LOCK_ROOM handler (Host only)
   */
  handleLockRoom(ws, payload, requestId) {
    const player = ws.player;
    const room = this.roomManager.getRoomById(player?.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can lock room', requestId);
    }

    room.isLocked = true;
    room.broadcast({
      type: MessageTypes.ROOM_LOCKED,
      payload: { isLocked: true },
    });
    this.sendResponse(ws, MessageTypes.ACK, { isLocked: true }, requestId);
  }

  /**
   * UNLOCK_ROOM handler (Host only)
   */
  handleUnlockRoom(ws, payload, requestId) {
    const player = ws.player;
    const room = this.roomManager.getRoomById(player?.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can unlock room', requestId);
    }

    room.isLocked = false;
    room.broadcast({
      type: MessageTypes.ROOM_LOCKED,
      payload: { isLocked: false },
    });
    this.sendResponse(ws, MessageTypes.ACK, { isLocked: false }, requestId);
  }

  /**
   * KICK_PLAYER handler (Host only)
   */
  handleKickPlayer(ws, payload, requestId) {
    const player = ws.player;
    const room = this.roomManager.getRoomById(player?.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can kick players', requestId);
    }

    const targetPlayerId = payload.playerId;
    if (!targetPlayerId) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'Target playerId is required', requestId);
    }

    if (targetPlayerId === player.id) {
      return this.sendError(ws, ErrorCodes.CANNOT_KICK_HOST, 'Host cannot kick themselves', requestId);
    }

    const targetMember = room.getMember(targetPlayerId);
    if (!targetMember) {
      return this.sendError(ws, ErrorCodes.PLAYER_NOT_FOUND, 'Target player not in room', requestId);
    }

    // Notify kicked player
    targetMember.send({
      type: MessageTypes.PLAYER_KICKED,
      payload: {
        reason: payload.reason || 'Kicked by room host',
      },
    });

    // Remove member
    room.removeMember(targetPlayerId);
    this.roomManager.unregisterPlayer(targetPlayerId);

    // Notify rest of room
    room.broadcast({
      type: MessageTypes.PLAYER_LEFT,
      payload: {
        playerId: targetPlayerId,
        kicked: true,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { kicked: targetPlayerId }, requestId);
  }

  /**
   * TRANSFER_HOST handler (Host only)
   */
  handleTransferHost(ws, payload, requestId) {
    const player = ws.player;
    const room = this.roomManager.getRoomById(player?.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can transfer host', requestId);
    }

    const targetPlayerId = payload.playerId;
    const targetMember = room.players.get(targetPlayerId);
    if (!targetMember) {
      return this.sendError(ws, ErrorCodes.PLAYER_NOT_FOUND, 'Target player must be an active player in room', requestId);
    }

    player.role = PlayerRole.PLAYER;
    const newHost = room.migrateHost(targetPlayerId);

    room.broadcast({
      type: MessageTypes.HOST_CHANGED,
      payload: {
        newHostId: newHost.id,
        previousHostId: player.id,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { newHostId: newHost.id }, requestId);
  }

  /**
   * UPDATE_ROOM_SETTINGS handler (Host only)
   */
  handleUpdateRoomSettings(ws, payload, requestId) {
    const player = ws.player;
    const room = this.roomManager.getRoomById(player?.currentRoomId);
    if (!room || room.hostId !== player.id) {
      return this.sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Only host can update room settings', requestId);
    }

    if (payload.name !== undefined) room.name = String(payload.name);
    if (payload.maxPlayers !== undefined) {
      room.maxPlayers = Math.max(room.playerCount(), Math.min(Number(payload.maxPlayers), 100));
    }
    if (payload.isPrivate !== undefined) room.isPrivate = Boolean(payload.isPrivate);
    if (payload.password !== undefined) room.password = payload.password ? String(payload.password) : null;
    if (payload.customData !== undefined && typeof payload.customData === 'object') {
      room.customData = { ...room.customData, ...payload.customData };
    }

    room.broadcast({
      type: MessageTypes.ROOM_SETTINGS_UPDATED,
      payload: {
        name: room.name,
        maxPlayers: room.maxPlayers,
        isPrivate: room.isPrivate,
        hasPassword: room.hasPassword(),
        customData: room.customData,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { success: true }, requestId);
  }

  /**
   * UPDATE_ROOM_STATE handler
   * Generic client-controlled shared state update
   */
  handleUpdateRoomState(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    const patch = payload.patch;
    if (!patch || typeof patch !== 'object') {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'patch object is required', requestId);
    }

    const updatedState = room.updateSharedState(patch);

    // Broadcast updated state to all members
    room.broadcast({
      type: MessageTypes.ROOM_STATE_UPDATED,
      payload: {
        senderId: player.id,
        patch,
        state: updatedState,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { state: updatedState }, requestId);
  }

  /**
   * UPDATE_PLAYER_STATE handler
   * Generic client-controlled personal player state update
   */
  handleUpdatePlayerState(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    const patch = payload.patch;
    if (!patch || typeof patch !== 'object') {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'patch object is required', requestId);
    }

    const updatedState = player.updateState(patch);

    // Broadcast updated player state to everyone in room
    room.broadcast({
      type: MessageTypes.PLAYER_STATE_UPDATED,
      payload: {
        playerId: player.id,
        patch,
        state: updatedState,
      },
    });

    this.sendResponse(ws, MessageTypes.ACK, { state: updatedState }, requestId);
  }

  /**
   * RELAY handler
   * Arbitrary generic data relay between clients
   */
  handleRelay(ws, payload, requestId) {
    const player = ws.player;
    if (!player || !player.currentRoomId) {
      return this.sendError(ws, ErrorCodes.NOT_IN_ROOM, 'Not in a room', requestId);
    }

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) {
      return this.sendError(ws, ErrorCodes.ROOM_NOT_FOUND, 'Room not found', requestId);
    }

    const { event, data, target } = payload;
    if (!event) {
      return this.sendError(ws, ErrorCodes.INVALID_PAYLOAD, 'event name is required', requestId);
    }

    const relayMessage = {
      type: MessageTypes.RELAY_MESSAGE,
      payload: {
        event,
        data,
        senderId: player.id,
        target: target || 'others',
        timestamp: Date.now(),
      },
    };

    if (target === 'all') {
      // Broadcast to everyone including sender
      room.broadcast(relayMessage, null);
    } else if (target === 'host') {
      // Send only to room host
      if (room.hostId) {
        room.sendTo(room.hostId, relayMessage);
      }
    } else if (target && target !== 'others') {
      // Send directly to specific player ID (whisper / direct message)
      const delivered = room.sendTo(target, relayMessage);
      if (!delivered) {
        return this.sendError(ws, ErrorCodes.PLAYER_NOT_FOUND, `Target player ${target} not found in room`, requestId);
      }
    } else {
      // Default: broadcast to all others in the room
      room.broadcast(relayMessage, player.id);
    }

    if (requestId) {
      this.sendResponse(ws, MessageTypes.ACK, { success: true }, requestId);
    }
  }

  /**
   * Socket disconnect handler with grace period
   * @param {import('ws').WebSocket} ws 
   */
  handleClose(ws) {
    const player = ws.player;
    if (!player || !player.currentRoomId) return;

    const room = this.roomManager.getRoomById(player.currentRoomId);
    if (!room) return;

    player.detachSocket();

    // Notify room that player disconnected with reconnect grace period
    room.broadcast({
      type: MessageTypes.PLAYER_DISCONNECTED,
      payload: {
        playerId: player.id,
        gracePeriodMs: config.reconnectGracePeriodMs,
      },
    }, player.id);

    // Set grace period timer
    player.disconnectTimer = setTimeout(() => {
      // If still disconnected after grace period, permanently remove
      if (player.status === PlayerStatus.DISCONNECTED) {
        console.log(`[WS] Grace period expired for player ${player.id}`);
        this.cleanlyLeaveCurrentRoom(player);
      }
    }, config.reconnectGracePeriodMs);

    if (player.disconnectTimer.unref) {
      player.disconnectTimer.unref();
    }
  }
}

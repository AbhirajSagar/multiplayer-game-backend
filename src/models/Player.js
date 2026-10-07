import crypto from 'crypto';
import { PlayerRole, PlayerStatus } from '../constants/protocol.js';

export class Player {
  /**
   * @param {Object} options
   * @param {string} [options.id]
   * @param {import('ws').WebSocket} [options.ws]
   * @param {string} [options.name]
   * @param {string} [options.role]
   * @param {Object} [options.customData]
   * @param {Object} [options.state]
   */
  constructor({
    id = `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    ws = null,
    name = 'Player',
    role = PlayerRole.PLAYER,
    customData = {},
    state = {},
  } = {}) {
    this.id = id;
    this.ws = ws;
    this.name = name || 'Player';
    this.role = role;
    this.status = PlayerStatus.ACTIVE;
    this.reconnectToken = crypto.randomUUID();
    this.ready = false;
    
    // Client-controlled state (e.g. position, score, health, cards, etc.)
    this.state = typeof state === 'object' && state !== null ? { ...state } : {};
    
    // Client-controlled player metadata (e.g. avatar, color, class, etc.)
    this.customData = typeof customData === 'object' && customData !== null ? { ...customData } : {};
    
    this.joinedAt = Date.now();
    this.disconnectedAt = null;
    this.disconnectTimer = null;
    this.currentRoomId = null;
  }

  /**
   * Send a JSON message to this player if socket is open
   * @param {Object} message 
   */
  send(message) {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      try {
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        this.ws.send(payload);
      } catch (err) {
        console.error(`Failed to send message to player ${this.id}:`, err.message);
      }
    }
  }

  /**
   * Updates client-controlled player state
   * @param {Object} patch 
   * @returns {Object} updated state
   */
  updateState(patch) {
    if (typeof patch === 'object' && patch !== null) {
      this.state = {
        ...this.state,
        ...patch,
      };
    }
    return this.state;
  }

  /**
   * Sets player socket and clears disconnect timer upon reconnect
   * @param {import('ws').WebSocket} ws 
   */
  attachSocket(ws) {
    this.ws = ws;
    this.status = PlayerStatus.ACTIVE;
    this.disconnectedAt = null;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }

  /**
   * Detaches socket and marks as disconnected
   */
  detachSocket() {
    this.ws = null;
    this.status = PlayerStatus.DISCONNECTED;
    this.disconnectedAt = Date.now();
  }

  /**
   * Serialize player for client consumption
   * @param {boolean} includePrivate
   */
  toJSON(includePrivate = false) {
    const data = {
      id: this.id,
      name: this.name,
      role: this.role,
      status: this.status,
      ready: this.ready,
      state: this.state,
      customData: this.customData,
      joinedAt: this.joinedAt,
      isDisconnected: this.status === PlayerStatus.DISCONNECTED,
    };

    if (includePrivate) {
      data.reconnectToken = this.reconnectToken;
    }

    return data;
  }
}

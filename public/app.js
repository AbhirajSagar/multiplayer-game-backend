import { MultiplayerClient } from './client-sdk.js';

// Application State
let client = null;
let currentRoom = null;
let myPlayerId = null;
let myReconnectToken = null;
let isReady = false;
let logCount = 0;

// DOM Elements
const connectionStatusEl = document.getElementById('connectionStatus');
const serverStatsEl = document.getElementById('serverStats');
const statRoomsEl = document.getElementById('statRooms');
const statPlayersEl = document.getElementById('statPlayers');

const lobbyScreen = document.getElementById('lobbyScreen');
const roomScreen = document.getElementById('roomScreen');

// Create Room form
const createPlayerNameInput = document.getElementById('createPlayerName');
const createRoomNameInput = document.getElementById('createRoomName');
const createGameTypeInput = document.getElementById('createGameType');
const createMaxPlayersInput = document.getElementById('createMaxPlayers');
const createCustomCodeInput = document.getElementById('createCustomCode');
const createPasswordInput = document.getElementById('createPassword');
const createIsPrivateInput = document.getElementById('createIsPrivate');
const createAllowSpectatorsInput = document.getElementById('createAllowSpectators');
const btnCreateRoom = document.getElementById('btnCreateRoom');

// Join Room form
const joinPlayerNameInput = document.getElementById('joinPlayerName');
const joinRoomCodeInput = document.getElementById('joinRoomCode');
const joinPasswordInput = document.getElementById('joinPassword');
const joinAsSpectatorInput = document.getElementById('joinAsSpectator');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const btnQuickJoin = document.getElementById('btnQuickJoin');

// Public Rooms
const publicRoomsList = document.getElementById('publicRoomsList');
const btnRefreshRooms = document.getElementById('btnRefreshRooms');
const roomSearchInput = document.getElementById('roomSearchInput');

// Room Banner
const roomTitleEl = document.getElementById('roomTitle');
const roomStatusBadge = document.getElementById('roomStatusBadge');
const roomTypeBadge = document.getElementById('roomTypeBadge');
const roomPrivacyBadge = document.getElementById('roomPrivacyBadge');
const displayRoomCode = document.getElementById('displayRoomCode');
const btnCopyCode = document.getElementById('btnCopyCode');
const btnCopyLink = document.getElementById('btnCopyLink');
const btnToggleReady = document.getElementById('btnToggleReady');
const btnStartGame = document.getElementById('btnStartGame');
const btnSimulateReconnect = document.getElementById('btnSimulateReconnect');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');

// Room Workspace
const memberCountEl = document.getElementById('memberCount');
const maxMemberCountEl = document.getElementById('maxMemberCount');
const myRoleTag = document.getElementById('myRoleTag');
const playersListEl = document.getElementById('playersList');

// Relay Controls
const relayEventInput = document.getElementById('relayEvent');
const relayTargetSelect = document.getElementById('relayTarget');
const relayPayloadInput = document.getElementById('relayPayload');
const btnSendRelay = document.getElementById('btnSendRelay');

// State Controls
const tabRoomState = document.getElementById('tabRoomState');
const tabPlayerState = document.getElementById('tabPlayerState');
const currentRoomStateJson = document.getElementById('currentRoomStateJson');
const currentPlayerStateJson = document.getElementById('currentPlayerStateJson');
const roomStatePatchInput = document.getElementById('roomStatePatchInput');
const playerStatePatchInput = document.getElementById('playerStatePatchInput');
const btnApplyRoomState = document.getElementById('btnApplyRoomState');
const btnApplyPlayerState = document.getElementById('btnApplyPlayerState');

// Logs & Toasts
const eventLogContainer = document.getElementById('eventLogContainer');
const logCountBadge = document.getElementById('logCountBadge');
const btnClearLogs = document.getElementById('btnClearLogs');
const toastContainer = document.getElementById('toastContainer');

// --- Helper Utilities ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️'}</span> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function appendLog(category, type, content) {
  logCount++;
  logCountBadge.textContent = `${logCount} events`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

  let badgeClass = 'log-type-relay';
  if (category === 'state') badgeClass = 'log-type-state';
  if (category === 'room') badgeClass = 'log-type-room';
  if (category === 'player') badgeClass = 'log-type-player';
  if (category === 'error') badgeClass = 'log-type-error';

  const formattedContent = typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content);

  entry.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-type ${badgeClass}">${type}</span>
    <span class="log-content">${formattedContent}</span>
  `;

  eventLogContainer.insertBefore(entry, eventLogContainer.firstChild);

  // Keep log size bounded
  if (eventLogContainer.children.length > 100) {
    eventLogContainer.removeChild(eventLogContainer.lastChild);
  }
}

// --- Initialize Client & Connect ---
function initClient() {
  client = new MultiplayerClient();

  client.on('connected', () => {
    connectionStatusEl.className = 'connection-status connected';
    connectionStatusEl.querySelector('.status-text').textContent = 'Online';
    showToast('Connected to game server', 'success');
    refreshPublicRooms();
    fetchStats();
  });

  client.on('disconnected', ({ wasConnected }) => {
    connectionStatusEl.className = 'connection-status disconnected';
    connectionStatusEl.querySelector('.status-text').textContent = 'Offline';
    if (wasConnected) {
      showToast('Disconnected from server', 'error');
    }
  });

  client.on('error', (err) => {
    appendLog('error', 'ERROR', err?.message || err);
    showToast(err?.message || 'Server error', 'error');
  });

  // Room lifecycle events
  client.on('roomCreated', (data) => {
    handleJoinedRoom(data);
    appendLog('room', 'ROOM_CREATED', { roomId: data.room.id, code: data.room.code });
    showToast(`Room created: ${data.room.code}`, 'success');
  });

  client.on('roomJoined', (data) => {
    handleJoinedRoom(data);
    appendLog('room', data.reconnected ? 'PLAYER_RECONNECTED' : 'ROOM_JOINED', { roomId: data.room.id, code: data.room.code });
    showToast(`Joined room: ${data.room.code}`, 'success');
  });

  client.on('roomLeft', () => {
    handleLeftRoom();
    appendLog('room', 'ROOM_LEFT', 'You left the room');
    showToast('Left room', 'info');
  });

  client.on('playerJoined', (player) => {
    appendLog('player', 'PLAYER_JOINED', `${player.name} (${player.id}) joined`);
    showToast(`${player.name} joined the room!`, 'info');
    renderRoomView();
  });

  client.on('playerLeft', (data) => {
    appendLog('player', 'PLAYER_LEFT', `Player ${data.playerId} left`);
    showToast('A player left the room', 'info');
    renderRoomView();
  });

  client.on('playerDisconnected', (data) => {
    appendLog('player', 'PLAYER_DISCONNECTED', `Player ${data.playerId} disconnected (grace period active)`);
    showToast('A player disconnected (reconnecting...)', 'info');
    renderRoomView();
  });

  client.on('playerReconnected', (data) => {
    appendLog('player', 'PLAYER_RECONNECTED', `Player ${data.playerId} reconnected!`);
    showToast('A player reconnected!', 'success');
    renderRoomView();
  });

  client.on('playerReadyChanged', (data) => {
    appendLog('player', 'READY_CHANGED', data);
    renderRoomView();
  });

  client.on('hostChanged', (data) => {
    appendLog('room', 'HOST_CHANGED', data);
    showToast(`New host assigned: ${data.newHostId}`, 'info');
    renderRoomView();
  });

  client.on('gameStarted', (data) => {
    appendLog('room', 'GAME_STARTED', data);
    showToast('🎮 The game has started!', 'success');
    renderRoomView();
  });

  client.on('gameEnded', (data) => {
    appendLog('room', 'GAME_ENDED', data);
    showToast('Match ended', 'info');
    renderRoomView();
  });

  client.on('roomLocked', (data) => {
    appendLog('room', 'ROOM_LOCKED', data);
    renderRoomView();
  });

  client.on('kicked', (reason) => {
    handleLeftRoom();
    appendLog('error', 'KICKED', reason);
    showToast(`You were kicked: ${reason}`, 'error');
  });

  // Client-Controlled State & Relay events
  client.on('roomStateUpdated', (data) => {
    appendLog('state', 'ROOM_STATE_UPDATED', data.patch);
    updateStateViewers();
  });

  client.on('playerStateUpdated', (data) => {
    appendLog('state', 'PLAYER_STATE_UPDATED', { playerId: data.playerId, patch: data.patch });
    updateStateViewers();
    renderRoomView();
  });

  client.on('relay', (event, data, senderId, fullPayload) => {
    appendLog('relay', `RELAY [${event}]`, { from: senderId, target: fullPayload.target, data });
  });

  client.connect().catch((err) => {
    console.error('Initial connection failed:', err);
  });
}

// --- Room State Transitions ---
function handleJoinedRoom(data) {
  currentRoom = data.room;
  myPlayerId = data.player.id;
  myReconnectToken = data.player.reconnectToken;
  isReady = data.player.ready || false;

  // Persist session in sessionStorage for smooth manual reloads
  sessionStorage.setItem('mp_room_id', currentRoom.id);
  sessionStorage.setItem('mp_player_id', myPlayerId);
  sessionStorage.setItem('mp_reconnect_token', myReconnectToken);

  lobbyScreen.classList.add('hidden');
  roomScreen.classList.remove('hidden');

  renderRoomView();
  updateStateViewers();
}

function handleLeftRoom() {
  currentRoom = null;
  myPlayerId = null;
  myReconnectToken = null;
  isReady = false;

  sessionStorage.removeItem('mp_room_id');
  sessionStorage.removeItem('mp_player_id');
  sessionStorage.removeItem('mp_reconnect_token');

  roomScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');

  refreshPublicRooms();
}

function renderRoomView() {
  if (!currentRoom || !client?.room) return;
  const room = client.room;

  roomTitleEl.textContent = room.name || 'Game Room';
  roomStatusBadge.textContent = (room.status || 'LOBBY').toUpperCase();
  roomStatusBadge.className = `badge badge-status ${room.status === 'playing' ? 'badge-primary' : ''}`;
  roomTypeBadge.textContent = room.gameType || 'generic';
  roomPrivacyBadge.textContent = room.isPrivate ? 'PRIVATE' : 'PUBLIC';
  displayRoomCode.textContent = room.code;

  const totalMembers = (room.players?.length || 0) + (room.spectators?.length || 0);
  memberCountEl.textContent = totalMembers;
  maxMemberCountEl.textContent = room.maxPlayers;

  // Check if current user is host
  const isHost = room.hostId === myPlayerId;
  myRoleTag.innerHTML = isHost 
    ? `<span class="badge badge-primary">👑 You are Host</span>`
    : `<span class="badge badge-secondary">Player</span>`;

  btnStartGame.classList.toggle('hidden', !isHost || room.status === 'playing');
  btnToggleReady.textContent = isReady ? 'Cancel Ready' : 'Ready Up';
  btnToggleReady.className = isReady ? 'btn btn-secondary' : 'btn btn-success';

  // Render player list
  playersListEl.innerHTML = '';
  const allMembers = [
    ...(room.players || []),
    ...(room.spectators || []),
  ];

  // Update target selector options for whispers
  relayTargetSelect.innerHTML = `
    <option value="others">All Others</option>
    <option value="all">Everyone (Incl. Self)</option>
    <option value="host">Host Only</option>
  `;

  allMembers.forEach((p) => {
    const isMe = p.id === myPlayerId;
    const isThisHost = room.hostId === p.id;
    const isDisconnected = p.isDisconnected || p.status === 'disconnected';

    // Add to whisper targets
    if (!isMe) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `Whisper: ${p.name}`;
      relayTargetSelect.appendChild(opt);
    }

    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <div class="player-info">
        <div class="player-avatar">${p.name ? p.name.charAt(0).toUpperCase() : 'P'}</div>
        <div class="player-name-box">
          <div class="player-name">
            ${escapeHtml(p.name)} ${isMe ? '<small style="color:var(--accent);">(You)</small>' : ''}
          </div>
          <div class="player-sub">
            ${isThisHost ? '👑 Host • ' : ''}${p.role === 'spectator' ? '👁️ Spectator' : 'Player'} 
            ${isDisconnected ? ' • <span style="color:var(--danger)">Disconnected</span>' : ''}
          </div>
        </div>
      </div>
      <div class="player-badges">
        ${p.role !== 'spectator' ? `
          <span class="ready-pill ${p.ready ? 'is-ready' : ''}">
            ${p.ready ? '✓ READY' : 'WAITING'}
          </span>
        ` : ''}
        ${isHost && !isMe ? `
          <button class="btn btn-sm btn-danger kick-btn" data-player-id="${p.id}" title="Kick player">✕</button>
        ` : ''}
      </div>
    `;

    playersListEl.appendChild(row);
  });

  // Attach kick listeners
  playersListEl.querySelectorAll('.kick-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetId = e.currentTarget.dataset.playerId;
      try {
        await client.kickPlayer(targetId, 'Removed by room host');
        showToast('Player kicked', 'info');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function updateStateViewers() {
  if (!client?.room) return;
  currentRoomStateJson.textContent = JSON.stringify(client.room.state || {}, null, 2);

  const me = (client.room.players || []).find(p => p.id === myPlayerId);
  currentPlayerStateJson.textContent = JSON.stringify(me?.state || {}, null, 2);
}

// --- Public Rooms & Stats ---
async function refreshPublicRooms() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    renderPublicRooms(data.rooms || []);
  } catch (err) {
    console.error('Failed to fetch public rooms:', err);
  }
}

function renderPublicRooms(rooms) {
  publicRoomsList.innerHTML = '';

  const filter = (roomSearchInput.value || '').toLowerCase().trim();
  const filtered = rooms.filter(r => 
    !filter || 
    r.name.toLowerCase().includes(filter) || 
    r.gameType.toLowerCase().includes(filter) ||
    r.code.toLowerCase().includes(filter)
  );

  if (filtered.length === 0) {
    publicRoomsList.innerHTML = `<div class="empty-state">${filter ? 'No matching rooms found' : 'No public rooms active right now.'}</div>`;
    return;
  }

  filtered.forEach(room => {
    const item = document.createElement('div');
    item.className = 'room-item-card';
    item.innerHTML = `
      <div class="room-item-info">
        <h4>${escapeHtml(room.name)}</h4>
        <div class="room-item-meta">
          <span>🎮 ${escapeHtml(room.gameType)}</span> • 
          <span>👥 ${room.playerCount}/${room.maxPlayers}</span> • 
          <span style="font-family:var(--font-mono); font-weight:700; color:#38bdf8;">${room.code}</span>
        </div>
      </div>
      <div>
        <button class="btn btn-sm btn-accent join-room-btn" data-code="${room.code}">
          Join
        </button>
      </div>
    `;

    item.querySelector('.join-room-btn').addEventListener('click', () => {
      joinRoomCodeInput.value = room.code;
      btnJoinRoom.click();
    });

    publicRoomsList.appendChild(item);
  });
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.stats) {
      statRoomsEl.textContent = `${data.stats.totalRooms} Room${data.stats.totalRooms === 1 ? '' : 's'}`;
      statPlayersEl.textContent = `${data.stats.totalPlayers} Player${data.stats.totalPlayers === 1 ? '' : 's'}`;
    }
  } catch {
    // Non-fatal
  }
}

// --- User Action Handlers ---
btnCreateRoom.addEventListener('click', async () => {
  const name = createRoomNameInput.value.trim() || 'Game Lobby';
  const gameType = createGameTypeInput.value.trim() || 'generic';
  const maxPlayers = parseInt(createMaxPlayersInput.value, 10) || 4;
  const roomCode = createCustomCodeInput.value.trim() || undefined;
  const password = createPasswordInput.value.trim() || undefined;
  const isPrivate = createIsPrivateInput.checked;
  const allowSpectators = createAllowSpectatorsInput.checked;
  const playerName = createPlayerNameInput.value.trim() || 'Host Player';

  try {
    await client.createRoom({
      name,
      gameType,
      maxPlayers,
      roomCode,
      password,
      isPrivate,
      allowSpectators,
      player: {
        name: playerName,
        state: { x: 0, y: 0, score: 0 },
        customData: { avatar: 'default' },
      },
      initialState: {
        round: 1,
        started: false,
      },
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnJoinRoom.addEventListener('click', async () => {
  const roomCode = joinRoomCodeInput.value.trim();
  const password = joinPasswordInput.value.trim() || undefined;
  const playerName = joinPlayerNameInput.value.trim() || 'Player';
  const asSpectator = joinAsSpectatorInput.checked;

  if (!roomCode) {
    showToast('Please enter a room code', 'error');
    return;
  }

  try {
    await client.joinRoom({
      roomCode,
      password,
      asSpectator,
      player: {
        name: playerName,
        state: { x: 50, y: 50, score: 0 },
        customData: { avatar: 'default' },
      },
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnQuickJoin.addEventListener('click', async () => {
  const playerName = joinPlayerNameInput.value.trim() || 'Quick Player';
  const gameType = createGameTypeInput.value.trim() || 'arena-battle';

  try {
    await client.quickJoin({
      gameType,
      createIfNotFound: true,
      player: {
        name: playerName,
        state: { x: 0, y: 0 },
      },
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnLeaveRoom.addEventListener('click', async () => {
  try {
    await client.leaveRoom();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnToggleReady.addEventListener('click', async () => {
  isReady = !isReady;
  try {
    await client.setReady(isReady);
    btnToggleReady.textContent = isReady ? 'Cancel Ready' : 'Ready Up';
    btnToggleReady.className = isReady ? 'btn btn-secondary' : 'btn btn-success';
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnStartGame.addEventListener('click', async () => {
  try {
    await client.startGame();
    showToast('Game Started!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// Copy Code & Link
btnCopyCode.addEventListener('click', () => {
  if (!client?.room?.code) return;
  navigator.clipboard.writeText(client.room.code);
  showToast('Room code copied to clipboard!', 'success');
});

btnCopyLink.addEventListener('click', () => {
  if (!client?.room?.code) return;
  const url = `${window.location.origin}${window.location.pathname}?join=${client.room.code}`;
  navigator.clipboard.writeText(url);
  showToast('Invite link copied to clipboard!', 'success');
});

// Simulate Disconnect & Reconnect
btnSimulateReconnect.addEventListener('click', async () => {
  if (!currentRoom || !myPlayerId || !myReconnectToken) return;

  const savedRoomId = currentRoom.id;
  const savedPlayerId = myPlayerId;
  const savedToken = myReconnectToken;

  showToast('Simulating network drop... Socket closing', 'info');
  client.disconnect();

  setTimeout(async () => {
    showToast('Re-establishing connection & sending reconnect token...', 'info');
    try {
      await client.connect();
      await client.reconnect(savedRoomId, savedPlayerId, savedToken);
      showToast('Successfully reconnected and resumed session!', 'success');
    } catch (err) {
      showToast(`Reconnect failed: ${err.message}`, 'error');
    }
  }, 2500);
});

// Relay message
btnSendRelay.addEventListener('click', () => {
  const event = relayEventInput.value.trim();
  const target = relayTargetSelect.value;
  const rawPayload = relayPayloadInput.value.trim();

  if (!event) {
    showToast('Event name is required', 'error');
    return;
  }

  let data;
  try {
    data = JSON.parse(rawPayload);
  } catch {
    data = rawPayload; // Allow string fallback
  }

  client.relay(event, data, target);
  appendLog('relay', `SENT [${event}]`, { target, data });
});

// Relay Templates
document.querySelectorAll('.btn-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const template = chip.dataset.template;
    if (template === 'chat') {
      relayEventInput.value = 'CHAT';
      relayPayloadInput.value = JSON.stringify({ text: 'Nice move!', sender: createPlayerNameInput.value }, null, 2);
    } else if (template === 'move') {
      relayEventInput.value = 'MOVE';
      relayPayloadInput.value = JSON.stringify({ x: Math.floor(Math.random() * 800), y: Math.floor(Math.random() * 600), velocity: [1.2, 0] }, null, 2);
    } else if (template === 'action') {
      relayEventInput.value = 'ACTION';
      relayPayloadInput.value = JSON.stringify({ action: 'ATTACK', targetId: 'enemy', damage: 45 }, null, 2);
    } else if (template === 'custom') {
      relayEventInput.value = 'CUSTOM_RPC';
      relayPayloadInput.value = JSON.stringify({ command: 'ROLL_DICE', sides: 6, result: Math.floor(Math.random() * 6) + 1 }, null, 2);
    }
  });
});

// State Patches
btnApplyRoomState.addEventListener('click', async () => {
  try {
    const patch = JSON.parse(roomStatePatchInput.value);
    await client.updateRoomState(patch);
    showToast('Room state updated', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

btnApplyPlayerState.addEventListener('click', async () => {
  try {
    const patch = JSON.parse(playerStatePatchInput.value);
    await client.updatePlayerState(patch);
    showToast('Player state updated', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// State Tabs
document.querySelectorAll('.state-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.state-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    if (tab === 'room-state') {
      tabRoomState.classList.remove('hidden');
      tabPlayerState.classList.add('hidden');
    } else {
      tabRoomState.classList.add('hidden');
      tabPlayerState.classList.remove('hidden');
    }
  });
});

// Clear Logs
btnClearLogs.addEventListener('click', () => {
  eventLogContainer.innerHTML = '';
  logCount = 0;
  logCountBadge.textContent = '0 events';
});

btnRefreshRooms.addEventListener('click', refreshPublicRooms);
roomSearchInput.addEventListener('input', () => refreshPublicRooms());

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Check URL query parameters for deep-linked room codes (e.g. ?join=ABCDEF)
function checkUrlJoinParam() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('join');
  if (code) {
    joinRoomCodeInput.value = code.toUpperCase();
    showToast(`Invite code ${code} detected from link!`, 'info');
  }
}

// Auto-uppercase room code input
joinRoomCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});
createCustomCodeInput.addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

// Boot
window.addEventListener('DOMContentLoaded', () => {
  initClient();
  checkUrlJoinParam();
  setInterval(refreshPublicRooms, 5000);
  setInterval(fetchStats, 5000);
});

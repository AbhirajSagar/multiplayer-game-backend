# 🎮 Generic Multiplayer Game Backend (Node.js)

A high-performance, agnostic WebSocket & REST multiplayer backend for Node.js. It features **client-controlled data sharing**, **public and private lobby management**, **shareable room codes**, **reconnection grace periods**, and a **built-in interactive visual test client**.

---

## ✨ Key Features

- **Game-Agnostic & Client-Controlled**: The server does not enforce game rules. Clients freely control and broadcast their own data, actions, and state slices.
- **Lobby & Room Management**:
  - **Shareable Room Codes**: Clean, human-friendly 6-character room codes (e.g. `K7X9PQ`) generated without confusing characters (0/O, 1/I, L).
  - **Public & Private Lobbies**: Private lobbies are hidden from discovery and joinable only by code or link.
  - **Password Protection**: Optional passwords for private matches.
  - **Deep Linking**: Shareable join links (e.g. `http://localhost:3000/?join=K7X9PQ`) that auto-fill room codes.
  - **Configurable Player Limits**: Set max players per lobby (e.g., 2 for chess, 4 for cards, 16+ for battle royales).
  - **Spectator Mode**: Allow players to spectate without occupying player slots.
  - **Host Controls & Migration**: Start game, lock/unlock lobby, kick players, and automatic host migration when the host leaves.
- **Multi-Mode Client Data Sharing**:
  - **Broadcast to Others (`target: 'others'`)**: Default relay to all other players in the room.
  - **Broadcast to All (`target: 'all'`)**: Relays to everyone including the sender.
  - **Targeted Whisper (`target: '<playerId>'`)**: Direct P2P messaging, private deals, or WebRTC signaling.
  - **Host Message (`target: 'host'`)**: Send events exclusively to the lobby host.
- **Client-Controlled State Synchronization**:
  - **Shared Room State**: Key-value state store patched by clients and synchronized to all members.
  - **Player State**: Each player manages their own state slice (position, HP, inventory, etc.).
  - **Automatic Catch-Up**: New players and reconnected players automatically receive current room and player state snapshots upon joining.
- **Session Reconnection Grace Period**:
  - Secret `reconnectToken` issued to each player.
  - If a connection drops (network glitch, page refresh), players have a configurable grace period (default 30s) to resume their session without losing their slot.
- **Universal Client SDK**:
  - Zero-dependency client SDK that runs in web browsers, Node.js, and game engines (Phaser, Three.js, Pixi, Godot, Unity WebGL, etc.).
- **Built-in Interactive Web Test Client**:
  - Real-time dashboard at `http://localhost:3000` to test multiple clients, lobbies, chat, state syncing, and reconnection.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
# Production start
npm start

# Development mode with auto-reload
npm run dev
```

The server will start on port `3000`:
- **Web Test Client & Dashboard**: [http://localhost:3000](http://localhost:3000)
- **WebSocket Endpoint**: `ws://localhost:3000/ws`
- **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)
- **Public Rooms API**: [http://localhost:3000/api/rooms](http://localhost:3000/api/rooms)

### 3. Run Automated Tests
```bash
npm test
```

---

## 💻 Client SDK Integration

The client SDK is available in `src/sdk/client.js` (ESM) and statically served at `/sdk/client.js` or `/client-sdk.js`.

### Browser / Frontend Integration (HTML / React / Vue / Phaser)

```html
<script type="module">
  import { MultiplayerClient } from '/client-sdk.js';

  const client = new MultiplayerClient();
  await client.connect();

  // Create a room
  const { room, player } = await client.createRoom({
    name: 'Arena 1',
    gameType: 'tictactoe',
    isPrivate: false,
    maxPlayers: 2,
    player: { name: 'Alice' },
    initialState: { board: [null, null, null, null, null, null, null, null, null] },
  });

  console.log(`Room Code: ${room.code}`);

  // Listen for relayed events from other players
  client.on('relay:PLAYER_MOVE', (data, senderId) => {
    console.log(`Player ${senderId} placed move at index ${data.index}`);
  });

  // Listen for shared room state updates
  client.on('roomStateUpdated', ({ state, patch }) => {
    console.log('Updated room board:', state.board);
  });
</script>
```

### Joining a Room by Code

```javascript
const client = new MultiplayerClient();
await client.connect();

const { room, player } = await client.joinRoom({
  roomCode: 'K7X9PQ',
  player: { name: 'Bob' },
});

// Broadcast action to other players
client.relay('PLAYER_MOVE', { index: 4, mark: 'O' });

// Patch shared room state
await client.updateRoomState({
  board: ['X', null, null, null, 'O', null, null, null, null],
  turn: 'Alice',
});
```

### Direct Whispers / P2P WebRTC Signaling

```javascript
// Whisper to a specific player ID
client.relay('SECRET_CARD', { card: 'Ace of Hearts' }, targetPlayerId);

// WebRTC Signaling offer/answer relay
client.relay('WEBRTC_OFFER', { sdp: peerOfferSdp }, peerPlayerId);
```

---

## 📡 WebSocket Protocol Reference

All WebSocket messages follow a standardized JSON envelope:

### Client -> Server

| Type | Payload Properties | Description |
|---|---|---|
| `CREATE_ROOM` | `{ name, gameType, isPrivate, password, maxPlayers, allowSpectators, customData, initialState, roomCode, player }` | Creates a new room and sets sender as host |
| `JOIN_ROOM` | `{ roomCode / roomId, password, asSpectator, player }` | Joins an existing room by code or ID |
| `QUICK_JOIN` | `{ gameType, createIfNotFound, roomOptions, player }` | Quick-matches into public room or creates one |
| `RECONNECT` | `{ roomId, playerId, reconnectToken }` | Resumes an interrupted player session |
| `LEAVE_ROOM` | `{}` | Gracefully leaves the current room |
| `SET_READY` | `{ ready: boolean }` | Sets player ready status |
| `START_GAME` | `{ lockRoom?: boolean, customData?: object }` | Host signals game start |
| `END_GAME` | `{ customData?: object }` | Host signals game end |
| `LOCK_ROOM` / `UNLOCK_ROOM` | `{}` | Host locks/unlocks room from new joins |
| `KICK_PLAYER` | `{ playerId, reason }` | Host kicks a player |
| `TRANSFER_HOST` | `{ playerId }` | Host transfers role to another player |
| `UPDATE_ROOM_SETTINGS` | `{ name, maxPlayers, isPrivate, password, customData }` | Host updates settings |
| `UPDATE_ROOM_STATE` | `{ patch: object }` | Merges client patch into shared room state |
| `UPDATE_PLAYER_STATE` | `{ patch: object }` | Merges client patch into personal player state |
| `RELAY` | `{ event: string, data: any, target?: "others" \| "all" \| "host" \| "<playerId>" }` | Relays arbitrary payload |
| `PING` | `{ timestamp?: number }` | Keepalive ping |

### Server -> Client Push Events

- `ROOM_CREATED` / `ROOM_JOINED`: Complete snapshot of room, player list, states, and secret `reconnectToken`.
- `PLAYER_JOINED`: Sent to members when a player joins.
- `PLAYER_LEFT`: Sent when a player leaves or disconnects permanently.
- `PLAYER_DISCONNECTED`: Sent when a player drops connection (reconnection grace period active).
- `PLAYER_RECONNECTED`: Sent when a disconnected player resumes their session.
- `PLAYER_READY_CHANGED`: Broadcasts ready status updates.
- `HOST_CHANGED`: Broadcasts when host transfers or migrates.
- `ROOM_STATE_UPDATED`: Broadcasts shared state patches and new state.
- `PLAYER_STATE_UPDATED`: Broadcasts player state patches and updated state.
- `RELAY_MESSAGE`: Delivers relayed custom event and data.
- `GAME_STARTED` / `GAME_ENDED`: Game lifecycle notifications.
- `PLAYER_KICKED`: Sent to kicked player with reason.
- `ERROR`: Sent on errors (`{ code, message }`).

---

## 🌐 REST API Endpoints

- `GET /health` - Server health, uptime, active rooms, and connected players.
- `GET /api/stats` - Server metrics.
- `GET /api/rooms` - Query public rooms.
  - Optional Query Parameters:
    - `gameType`: filter by game type identifier
    - `hasSlots=true`: return only rooms with open player slots
    - `isJoinable=true`: return only unlocked rooms not at capacity
    - `search`: search by name or game type
- `GET /api/rooms/:identifier` - Retrieve details for a specific room by code or ID.
- `POST /api/rooms` - REST room creation for external matchmaking services.

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP & WebSocket server port |
| `HOST` | `0.0.0.0` | Bind host address |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `PING_INTERVAL_MS` | `30000` | WebSocket heartbeat interval (30s) |
| `RECONNECT_GRACE_PERIOD_MS` | `30000` | Time a disconnected player has to reconnect (30s) |
| `EMPTY_ROOM_CLEANUP_MS` | `10000` | Cleanup delay for empty rooms (10s) |
| `ROOM_CODE_LENGTH` | `6` | Length of generated share codes |

---

## 🧪 Testing

The codebase includes 17 automated tests covering all core mechanics:

```bash
npm test
```

Test suites include:
- `room-lifecycle.test.js`: Creation, joining, capacities, passwords, and host migration.
- `relay-data.test.js`: Broadcasts, whispers, targeted delivery, and kick actions.
- `state-sync.test.js`: Shared room state patches, player state patches, and new-player catch-up.
- `reconnect.test.js`: Secret reconnect tokens, disconnect grace periods, and session recovery.
- `api-http.test.js`: REST endpoints, public filtering, and room lookup.
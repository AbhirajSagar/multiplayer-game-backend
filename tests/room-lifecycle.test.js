import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { MultiplayerClient } from '../src/sdk/client.js';

describe('Room Lifecycle & Lobby Tests', () => {
  let serverInstance;
  let testPort = 4001;
  let wsUrl;

  before(async () => {
    serverInstance = createServer();
    const info = await serverInstance.start(testPort, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${info.port}/ws`;
  });

  after(async () => {
    await serverInstance.stop();
  });

  test('Host can create a public room and receive share code', async () => {
    const client = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    await client.connect();

    const res = await client.createRoom({
      name: 'Test Room 1',
      gameType: 'deathmatch',
      maxPlayers: 4,
      isPrivate: false,
      player: { name: 'PlayerHost' },
      initialState: { map: 'crossfire' },
    });

    assert.ok(res.room.id, 'Room has an ID');
    assert.ok(res.room.code, 'Room has a share code');
    assert.strictEqual(res.room.code.length, 6, 'Share code length is 6');
    assert.strictEqual(res.room.name, 'Test Room 1');
    assert.strictEqual(res.player.role, 'host');
    assert.strictEqual(res.room.state.map, 'crossfire');

    client.disconnect();
  });

  test('Second player can join room by share code', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const hostRes = await host.createRoom({
      name: 'Joinable Room',
      maxPlayers: 2,
      player: { name: 'Alice' },
    });

    const roomCode = hostRes.room.code;

    // Track guest join notification on host
    let hostNotified = false;
    host.on('playerJoined', (player) => {
      if (player.name === 'Bob') hostNotified = true;
    });

    const guestRes = await guest.joinRoom({
      roomCode,
      player: { name: 'Bob' },
    });

    assert.strictEqual(guestRes.room.code, roomCode);
    assert.strictEqual(guestRes.room.players.length, 2);
    assert.strictEqual(guestRes.player.role, 'player');

    // Give a brief tick for message delivery
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(hostNotified, true, 'Host should be notified of guest joining');

    host.disconnect();
    guest.disconnect();
  });

  test('Room capacity is enforced', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest1.connect();
    await guest2.connect();

    const hostRes = await host.createRoom({
      maxPlayers: 2,
      player: { name: 'Host' },
    });

    await guest1.joinRoom({
      roomCode: hostRes.room.code,
      player: { name: 'Guest1' },
    });

    // 3rd player joining should fail because maxPlayers is 2
    await assert.rejects(
      async () => {
        await guest2.joinRoom({
          roomCode: hostRes.room.code,
          player: { name: 'Guest2' },
        });
      },
      /maximum player capacity/
    );

    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });

  test('Password protection is enforced for private rooms', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const hostRes = await host.createRoom({
      password: 'supersecretpass',
      isPrivate: true,
      player: { name: 'Host' },
    });

    // Fails with wrong password
    await assert.rejects(
      async () => {
        await guest.joinRoom({
          roomCode: hostRes.room.code,
          password: 'wrongpassword',
          player: { name: 'Guest' },
        });
      },
      /Incorrect room password/
    );

    // Succeeds with correct password
    const success = await guest.joinRoom({
      roomCode: hostRes.room.code,
      password: 'supersecretpass',
      player: { name: 'Guest' },
    });

    assert.ok(success.room.id);

    host.disconnect();
    guest.disconnect();
  });

  test('Host migration when host leaves room', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const hostRes = await host.createRoom({
      player: { name: 'HostAlice' },
    });

    let newHostAssigned = false;
    guest.on('hostChanged', (data) => {
      if (data.newHostId === guest.playerId) {
        newHostAssigned = true;
      }
    });

    await guest.joinRoom({
      roomCode: hostRes.room.code,
      player: { name: 'GuestBob' },
    });

    await host.leaveRoom();

    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(newHostAssigned, true, 'Guest should become new host');

    host.disconnect();
    guest.disconnect();
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { MultiplayerClient } from '../src/sdk/client.js';

describe('Player Reconnection & Session Recovery Tests', () => {
  let serverInstance;
  let testPort = 4004;
  let wsUrl;

  before(async () => {
    serverInstance = createServer();
    const info = await serverInstance.start(testPort, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${info.port}/ws`;
  });

  after(async () => {
    await serverInstance.stop();
  });

  test('Player receives reconnect token and can resume session after connection drop', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const hostRes = await host.createRoom({ player: { name: 'Host' } });
    const guestRes = await guest.joinRoom({
      roomCode: hostRes.room.code,
      player: { name: 'Guest', state: { inventory: ['sword'] } },
    });

    const guestPlayerId = guestRes.player.id;
    const reconnectToken = guestRes.player.reconnectToken;
    const roomId = hostRes.room.id;

    assert.ok(reconnectToken, 'Player received secret reconnect token');

    let hostDetectedDisconnect = false;
    let hostDetectedReconnect = false;

    host.on('playerDisconnected', (data) => {
      if (data.playerId === guestPlayerId) {
        hostDetectedDisconnect = true;
      }
    });

    host.on('playerReconnected', (data) => {
      if (data.playerId === guestPlayerId) {
        hostDetectedReconnect = true;
      }
    });

    // Simulate Guest dropping connection
    guest.disconnect();

    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(hostDetectedDisconnect, true, 'Host notified of player disconnect');

    // Create a new client instance for Guest (simulating tab reload or reconnection)
    const resumedGuest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    await resumedGuest.connect();

    const resumeRes = await resumedGuest.reconnect(roomId, guestPlayerId, reconnectToken);

    assert.ok(resumeRes.room);
    assert.strictEqual(resumeRes.reconnected, true);
    assert.strictEqual(resumedGuest.playerId, guestPlayerId);

    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(hostDetectedReconnect, true, 'Host notified of player reconnected');

    host.disconnect();
    resumedGuest.disconnect();
  });

  test('Reconnection rejected with invalid reconnect token', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const hostRes = await host.createRoom({ player: { name: 'Host' } });
    const guestRes = await guest.joinRoom({
      roomCode: hostRes.room.code,
      player: { name: 'Guest' },
    });

    guest.disconnect();

    const intruder = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    await intruder.connect();

    await assert.rejects(
      async () => {
        await intruder.reconnect(hostRes.room.id, guestRes.player.id, 'bad-fake-token');
      },
      /Invalid reconnect token/
    );

    host.disconnect();
    intruder.disconnect();
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { MultiplayerClient } from '../src/sdk/client.js';

describe('Client-Controlled Data Relay Tests', () => {
  let serverInstance;
  let testPort = 4002;
  let wsUrl;

  before(async () => {
    serverInstance = createServer();
    const info = await serverInstance.start(testPort, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${info.port}/ws`;
  });

  after(async () => {
    await serverInstance.stop();
  });

  test('Broadcast custom game action to other players', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();
    await p2.connect();

    const roomRes = await p1.createRoom({ player: { name: 'Player1' } });
    await p2.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player2' } });

    let p1Received = false;
    let p2ReceivedData = null;

    p1.on('relay:PLAYER_ACTION', () => { p1Received = true; });
    p2.on('relay:PLAYER_ACTION', (data, senderId) => {
      p2ReceivedData = { data, senderId };
    });

    const customPayload = {
      action: 'CAST_SPELL',
      spellId: 'fireball',
      coords: { x: 120.5, y: 84.2 },
      damage: 75,
      meta: ['fire', 'aoe'],
    };

    // P1 relays event (default target: 'others')
    p1.relay('PLAYER_ACTION', customPayload);

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(p1Received, false, 'Sender should not receive own broadcast when target is others');
    assert.ok(p2ReceivedData, 'Receiver should get relayed event');
    assert.deepStrictEqual(p2ReceivedData.data, customPayload);
    assert.strictEqual(p2ReceivedData.senderId, p1.playerId);

    p1.disconnect();
    p2.disconnect();
  });

  test('Broadcast to all members including sender', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();
    await p2.connect();

    const roomRes = await p1.createRoom({ player: { name: 'Player1' } });
    await p2.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player2' } });

    let p1Received = false;
    let p2Received = false;

    p1.on('relay:GLOBAL_ANNOUNCEMENT', () => { p1Received = true; });
    p2.on('relay:GLOBAL_ANNOUNCEMENT', () => { p2Received = true; });

    p1.relay('GLOBAL_ANNOUNCEMENT', { text: 'Round 1 begins!' }, 'all');

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(p1Received, true, 'Sender receives when target is "all"');
    assert.strictEqual(p2Received, true, 'Other player receives when target is "all"');

    p1.disconnect();
    p2.disconnect();
  });

  test('Direct targeted whisper to specific player ID (P2P / WebRTC signaling)', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p3 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();
    await p2.connect();
    await p3.connect();

    const roomRes = await p1.createRoom({ maxPlayers: 3, player: { name: 'Player1' } });
    await p2.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player2' } });
    await p3.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player3' } });

    let p2Secret = null;
    let p3Received = false;

    p2.on('relay:SECRET_DEAL', (data) => { p2Secret = data; });
    p3.on('relay:SECRET_DEAL', () => { p3Received = true; });

    // P1 sends secret directly to P2
    p1.relay('SECRET_DEAL', { secretCard: 'Ace of Diamonds' }, p2.playerId);

    await new Promise(r => setTimeout(r, 100));

    assert.ok(p2Secret, 'Target player received the secret message');
    assert.strictEqual(p2Secret.secretCard, 'Ace of Diamonds');
    assert.strictEqual(p3Received, false, 'Non-target player did NOT receive the whisper');

    p1.disconnect();
    p2.disconnect();
    p3.disconnect();
  });

  test('Host can kick another player from the room', async () => {
    const host = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const guest = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await host.connect();
    await guest.connect();

    const roomRes = await host.createRoom({ player: { name: 'Host' } });
    const guestRes = await guest.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Guest' } });

    let guestKickedReason = null;
    guest.on('kicked', (reason) => {
      guestKickedReason = reason;
    });

    await host.kickPlayer(guestRes.player.id, 'AFK for too long');

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(guestKickedReason, 'AFK for too long');
    assert.strictEqual(guest.room, null, 'Kicked player room is reset');

    host.disconnect();
    guest.disconnect();
  });
});

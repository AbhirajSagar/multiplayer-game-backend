import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { MultiplayerClient } from '../src/sdk/client.js';

describe('Client-Controlled State Sync Tests', () => {
  let serverInstance;
  let testPort = 4003;
  let wsUrl;

  before(async () => {
    serverInstance = createServer();
    const info = await serverInstance.start(testPort, '127.0.0.1');
    wsUrl = `ws://127.0.0.1:${info.port}/ws`;
  });

  after(async () => {
    await serverInstance.stop();
  });

  test('Updating shared room state broadcasts to all room members', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();
    await p2.connect();

    const roomRes = await p1.createRoom({
      initialState: { round: 1, currentTurn: 'Player1' },
      player: { name: 'Player1' },
    });

    await p2.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player2' } });

    let p2NotifiedState = null;
    p2.on('roomStateUpdated', (data) => {
      p2NotifiedState = data.state;
    });

    // P1 updates shared room state
    await p1.updateRoomState({ round: 2, currentTurn: 'Player2', diceValue: 6 });

    await new Promise(r => setTimeout(r, 100));

    assert.ok(p2NotifiedState);
    assert.strictEqual(p2NotifiedState.round, 2);
    assert.strictEqual(p2NotifiedState.currentTurn, 'Player2');
    assert.strictEqual(p2NotifiedState.diceValue, 6);

    p1.disconnect();
    p2.disconnect();
  });

  test('Updating personal player state broadcasts to other members', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();
    await p2.connect();

    const roomRes = await p1.createRoom({ player: { name: 'Player1', state: { hp: 100, x: 0 } } });
    await p2.joinRoom({ roomCode: roomRes.room.code, player: { name: 'Player2' } });

    let p2ReceivedUpdate = null;
    p2.on('playerStateUpdated', (data) => {
      p2ReceivedUpdate = data;
    });

    // P1 moves and takes damage
    await p1.updatePlayerState({ hp: 85, x: 120 });

    await new Promise(r => setTimeout(r, 100));

    assert.ok(p2ReceivedUpdate);
    assert.strictEqual(p2ReceivedUpdate.playerId, p1.playerId);
    assert.strictEqual(p2ReceivedUpdate.state.hp, 85);
    assert.strictEqual(p2ReceivedUpdate.state.x, 120);

    p1.disconnect();
    p2.disconnect();
  });

  test('New player automatically catches up with current room and player states', async () => {
    const p1 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });
    const p2 = new MultiplayerClient({ url: wsUrl, WebSocketClass: WebSocket });

    await p1.connect();

    // P1 sets up room and updates state before P2 arrives
    const roomRes = await p1.createRoom({
      initialState: { level: 5, difficulty: 'expert' },
      player: { name: 'Veteran', state: { score: 9990, weapon: 'laser' } },
    });

    // P1 applies more patches
    await p1.updateRoomState({ bossHp: 500 });
    await p1.updatePlayerState({ score: 10000 });

    // Now P2 connects and joins
    await p2.connect();
    const joinRes = await p2.joinRoom({
      roomCode: roomRes.room.code,
      player: { name: 'Newbie' },
    });

    // P2 should immediately have all current room state
    assert.strictEqual(joinRes.room.state.level, 5);
    assert.strictEqual(joinRes.room.state.bossHp, 500);

    // P2 should have P1's latest state in the players list
    const p1InRoom = joinRes.room.players.find(p => p.id === p1.playerId);
    assert.ok(p1InRoom, 'P1 is in player list');
    assert.strictEqual(p1InRoom.state.score, 10000);
    assert.strictEqual(p1InRoom.state.weapon, 'laser');

    p1.disconnect();
    p2.disconnect();
  });
});

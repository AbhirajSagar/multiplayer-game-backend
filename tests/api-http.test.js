import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from '../src/server.js';

describe('HTTP REST API Tests', () => {
  let serverInstance;
  let testPort = 4005;
  let baseUrl;

  before(async () => {
    serverInstance = createServer();
    const info = await serverInstance.start(testPort, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${info.port}`;
  });

  after(async () => {
    await serverInstance.stop();
  });

  test('GET /health returns status ok and stats', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.uptimeSeconds !== undefined);
    assert.ok(data.stats);
  });

  test('GET /api/rooms lists public rooms and excludes private rooms', async () => {
    // Create 1 public room and 1 private room
    const pubRoom = serverInstance.roomManager.createRoom({
      name: 'Public Lobby',
      gameType: 'racing',
      isPrivate: false,
      maxPlayers: 8,
    });

    const privRoom = serverInstance.roomManager.createRoom({
      name: 'Secret Guild',
      gameType: 'rpg',
      isPrivate: true,
      maxPlayers: 4,
    });

    const res = await fetch(`${baseUrl}/api/rooms`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    const publicFound = data.rooms.find(r => r.code === pubRoom.code);
    const privateFound = data.rooms.find(r => r.code === privRoom.code);

    assert.ok(publicFound, 'Public room is listed');
    assert.strictEqual(privateFound, undefined, 'Private room is NOT listed');
  });

  test('GET /api/rooms/:identifier fetches room details by code or ID', async () => {
    const room = serverInstance.roomManager.createRoom({
      name: 'Search Me',
      gameType: 'cards',
      maxPlayers: 2,
    });

    // Lookup by code
    const resByCode = await fetch(`${baseUrl}/api/rooms/${room.code}`);
    assert.strictEqual(resByCode.status, 200);
    const dataByCode = await resByCode.json();
    assert.strictEqual(dataByCode.room.id, room.id);
    assert.strictEqual(dataByCode.room.code, room.code);

    // Lookup by ID
    const resById = await fetch(`${baseUrl}/api/rooms/${room.id}`);
    assert.strictEqual(resById.status, 200);
    const dataById = await resById.json();
    assert.strictEqual(dataById.room.id, room.id);
  });
});

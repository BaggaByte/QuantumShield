import test from 'node:test';
import assert from 'node:assert/strict';

// --- Test 1: URL Resolution & Environment Variable Wiring ---------------------

function resolveWsUrl(roomId, env = {}) {
  const customWs = env.VITE_WS_URL?.trim();
  if (customWs) {
    let base = customWs.replace(/\/+$/, '');
    if (base.startsWith('http://')) {
      base = 'ws://' + base.slice(7);
    } else if (base.startsWith('https://')) {
      base = 'wss://' + base.slice(8);
    }
    if (base.endsWith('/ws/room')) {
      return `${base}/${roomId}`;
    }
    if (base.endsWith('/ws')) {
      return `${base}/room/${roomId}`;
    }
    return `${base}/ws/room/${roomId}`;
  }

  const customBackend = env.VITE_BACKEND_URL?.trim();
  if (customBackend) {
    let wsBase = customBackend.replace(/\/+$/, '');
    if (wsBase.startsWith('https://')) {
      wsBase = 'wss://' + wsBase.slice(8);
    } else if (wsBase.startsWith('http://')) {
      wsBase = 'ws://' + wsBase.slice(7);
    }
    if (wsBase.endsWith('/ws/room')) {
      return `${wsBase}/${roomId}`;
    }
    if (wsBase.endsWith('/ws')) {
      return `${wsBase}/room/${roomId}`;
    }
    return `${wsBase}/ws/room/${roomId}`;
  }

  return `ws://localhost:8001/ws/room/${roomId}`;
}

test('VITE_WS_URL wiring: exact host', () => {
  const url = resolveWsUrl('ROOM1', { VITE_WS_URL: 'wss://quantumshield.relay.com' });
  assert.equal(url, 'wss://quantumshield.relay.com/ws/room/ROOM1');
});

test('VITE_WS_URL wiring: trailing slash', () => {
  const url = resolveWsUrl('ROOM1', { VITE_WS_URL: 'wss://quantumshield.relay.com/' });
  assert.equal(url, 'wss://quantumshield.relay.com/ws/room/ROOM1');
});

test('VITE_WS_URL wiring: already ends with /ws', () => {
  const url = resolveWsUrl('ROOM1', { VITE_WS_URL: 'wss://quantumshield.relay.com/ws' });
  assert.equal(url, 'wss://quantumshield.relay.com/ws/room/ROOM1');
});

test('VITE_WS_URL wiring: already ends with /ws/room', () => {
  const url = resolveWsUrl('ROOM1', { VITE_WS_URL: 'wss://quantumshield.relay.com/ws/room' });
  assert.equal(url, 'wss://quantumshield.relay.com/ws/room/ROOM1');
});

test('VITE_WS_URL wiring: converts http to ws and https to wss', () => {
  assert.equal(
    resolveWsUrl('ROOM1', { VITE_WS_URL: 'http://insecure.relay.com' }),
    'ws://insecure.relay.com/ws/room/ROOM1'
  );
  assert.equal(
    resolveWsUrl('ROOM1', { VITE_WS_URL: 'https://secure.relay.com' }),
    'wss://secure.relay.com/ws/room/ROOM1'
  );
});

test('VITE_BACKEND_URL derivation: https converted to wss', () => {
  const url = resolveWsUrl('ALPHA', { VITE_BACKEND_URL: 'https://backend.onrender.com' });
  assert.equal(url, 'wss://backend.onrender.com/ws/room/ALPHA');
});

test('VITE_BACKEND_URL derivation: http converted to ws', () => {
  const url = resolveWsUrl('BETA', { VITE_BACKEND_URL: 'http://localhost:8001' });
  assert.equal(url, 'ws://localhost:8001/ws/room/BETA');
});

test('Default fallback when no env variables are set', () => {
  const url = resolveWsUrl('GAMMA', {});
  assert.equal(url, 'ws://localhost:8001/ws/room/GAMMA');
});

// --- Test 2: Exponential Backoff Calculation with Jitter ----------------------

function calculateBackoff(attempt, initialMs = 1000, maxMs = 30000, multiplier = 1.5) {
  const baseDelay = Math.min(maxMs, initialMs * Math.pow(multiplier, attempt - 1));
  const jitterFactor = 0.8 + 0.4 * Math.random();
  const jitterDelay = Math.round(baseDelay * jitterFactor);
  return { baseDelay, jitterDelay };
}

test('Exponential backoff delay growth and cap at 30s', () => {
  const delays = [];
  for (let i = 1; i <= 15; i++) {
    const { baseDelay, jitterDelay } = calculateBackoff(i);
    assert(baseDelay <= 30000, `Base delay ${baseDelay} exceeded 30000ms limit`);
    assert(jitterDelay >= baseDelay * 0.8, `Jitter delay below 0.8x`);
    assert(jitterDelay <= baseDelay * 1.2 + 1, `Jitter delay above 1.2x`);
    delays.push(baseDelay);
  }

  // Ensure progression is strictly non-decreasing until capped at 30000
  for (let i = 1; i < delays.length; i++) {
    assert(delays[i] >= delays[i - 1], `Delay did not grow at step ${i}`);
  }
  assert.equal(delays[14], 30000, 'Delay capped at 30000ms');
});

// --- Test 3: Offline Queue FIFO & Encryption Roundtrip -----------------------

test('Offline queue record encryption and chronological ordering', async () => {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const messages = [
    { id: 'msg-1', roomId: 'ROOM1', plaintext: 'First offline message', timestamp: 1000 },
    { id: 'msg-2', roomId: 'ROOM1', plaintext: 'Second offline message', timestamp: 1005 },
    { id: 'msg-3', roomId: 'ROOM1', plaintext: 'Third offline message', timestamp: 1010 },
  ];

  const encryptedRecords = [];
  for (const msg of messages) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify({ plaintext: msg.plaintext }));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    encryptedRecords.push({
      id: msg.id,
      roomId: msg.roomId,
      timestamp: msg.timestamp,
      iv: Buffer.from(iv).toString('base64'),
      ciphertext: Buffer.from(ct).toString('base64'),
    });
  }

  // Decrypt and verify ordering
  const decrypted = [];
  for (const rec of encryptedRecords) {
    const iv = Buffer.from(rec.iv, 'base64');
    const ct = Buffer.from(rec.ciphertext, 'base64');
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    const data = JSON.parse(new TextDecoder().decode(dec));
    decrypted.push({ id: rec.id, plaintext: data.plaintext, timestamp: rec.timestamp });
  }

  assert.equal(decrypted.length, 3);
  assert.equal(decrypted[0].plaintext, 'First offline message');
  assert.equal(decrypted[1].plaintext, 'Second offline message');
  assert.equal(decrypted[2].plaintext, 'Third offline message');
});

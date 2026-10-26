/**
 * QuantumShield - Backend API Client
 */

export const getBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    // 1. Local Vite dev server -> connect directly to local FastAPI backend on 8001
    if (window.location.port === '5173' || window.location.port === '5174') {
      return `http://${window.location.hostname}:8001/`;
    }
    // 2. On Vercel (*.vercel.app), ALWAYS use same-origin reverse proxy ('/')
    // This routes through vercel.json rewrites, bypassing all cross-origin browser CORS errors
    if (window.location.hostname.endsWith('.vercel.app')) {
      return '/';
    }
  }

  // 3. Explicit environment variable configuration (e.g. Docker, native, custom domains)
  const customUrl = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_BACKEND_URL?.trim();
  if (customUrl) {
    return customUrl.endsWith('/') ? customUrl : `${customUrl}/`;
  }

  if (typeof window !== 'undefined') {
    return '/';
  }
  return 'http://localhost:8001/';
};

export interface CreateRoomResponse {
  room_id: string;
  created: boolean;
}

export interface RoomInfo {
  room_id: string;
  participants: number;
  crypto_mode: string | null;
  handshake_complete: boolean;
}

export interface HealthResponse {
  status: string;
  uptime_seconds: number;
  version: string;
  rooms_active: number;
}

export interface SecurityStatus {
  server_stores_plaintext: boolean;
  server_stores_keys: boolean;
  relay_only: boolean;
  supported_modes: string[];
  disclaimer: string;
}

export interface BenchmarkConfig {
  supported_modes: string[];
  max_trials: number;
  supported_message_sizes: number[];
  notes: string;
}

async function fetchJSON<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const res = await fetch(`${base}${cleanPath}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchJSON<HealthResponse>('health'),
  createRoom: () => fetchJSON<CreateRoomResponse>('rooms', { method: 'POST' }),
  getRoom: (roomId: string) => fetchJSON<RoomInfo>(`rooms/${roomId}`),
  securityStatus: () => fetchJSON<SecurityStatus>('api/security/status'),
  benchmarkConfig: () => fetchJSON<BenchmarkConfig>('api/benchmarks/config'),
  getVapidPublicKey: () => fetchJSON<{ public_key: string }>('api/push/vapid-public-key'),
  subscribePush: (roomId: string, participantId: string, subscription: unknown) =>
    fetchJSON<{ status: string }>('api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, participant_id: participantId, subscription }),
    }),
  unsubscribePush: (roomId: string, participantId: string) =>
    fetchJSON<{ status: string }>('api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: roomId, participant_id: participantId }),
    }),
};

export function getWebSocketUrl(roomId: string): string {
  // Check for explicit WebSocket URL
  const customWs = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_WS_URL?.trim();
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

  // Derive WebSocket URL from VITE_BACKEND_URL or Vercel default if provided
  let customBackend = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_BACKEND_URL?.trim();
  if (!customBackend && typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app')) {
    customBackend = 'https://quantumshield-3j5t.onrender.com/';
  }

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

  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (typeof window !== 'undefined' && (window.location.port === '5173' || window.location.port === '5174')) {
    return `ws://${window.location.hostname}:8001/ws/room/${roomId}`;
  }
  if (typeof window !== 'undefined') {
    return `${protocol}//${window.location.host}/ws/room/${roomId}`;
  }
  return `ws://localhost:8001/ws/room/${roomId}`;
}

export function createWebSocket(roomId: string): WebSocket {
  return new WebSocket(getWebSocketUrl(roomId));
}

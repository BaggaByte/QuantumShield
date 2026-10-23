/**
 * QuantumShield - Backend API Client
 */

const BASE_URL = '/';

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
  const res = await fetch(`${BASE_URL}${path}`, options);
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
};

export function createWebSocket(roomId: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return new WebSocket(`${protocol}//${host}/ws/room/${roomId}`);
}

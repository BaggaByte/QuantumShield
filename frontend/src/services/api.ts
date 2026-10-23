/**
 * QuantumShield - Backend API Client
 */

const getBaseUrl = (): string => {
  if (typeof window !== 'undefined') {
    // If running in Vite dev server (port 5173), point directly to FastAPI backend on 8001
    if (window.location.port === '5173' || window.location.port === '5174') {
      return `http://${window.location.hostname}:8001/`;
    }
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

export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: 'backend' | 'client';
  logger: string;
  message: string;
}

export interface LogsResponse {
  logs: SystemLogEntry[];
  total_buffered: number;
}

export const api = {
  health: () => fetchJSON<HealthResponse>('health'),
  createRoom: () => fetchJSON<CreateRoomResponse>('rooms', { method: 'POST' }),
  getRoom: (roomId: string) => fetchJSON<RoomInfo>(`rooms/${roomId}`),
  securityStatus: () => fetchJSON<SecurityStatus>('api/security/status'),
  benchmarkConfig: () => fetchJSON<BenchmarkConfig>('api/benchmarks/config'),
  systemLogs: (limit = 150) => fetchJSON<LogsResponse>(`api/system/logs?limit=${limit}`),
};

export function createWebSocket(roomId: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (typeof window !== 'undefined' && (window.location.port === '5173' || window.location.port === '5174')) {
    return new WebSocket(`ws://${window.location.hostname}:8001/ws/room/${roomId}`);
  }
  return new WebSocket(`${protocol}//${window.location.host}/ws/room/${roomId}`);
}

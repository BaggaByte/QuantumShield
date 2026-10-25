/**
 * QuantumShield - Live Security & Event Logger
 * Unified logging bus for client-side cryptographic events and backend relay messages.
 */
export interface SystemLogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: 'backend' | 'client';
  logger: string;
  message: string;
}

type LogListener = (entry: SystemLogEntry) => void;

class EventBus {
  private listeners: Set<LogListener> = new Set();
  private clientHistory: SystemLogEntry[] = [];

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  log(level: 'INFO' | 'CRYPTO' | 'KEM' | 'SECURITY' | 'WARN' | 'ERROR', logger: string, message: string) {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const entry: SystemLogEntry = {
      id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp,
      level,
      source: 'client',
      logger,
      message,
    };
    this.clientHistory.push(entry);
    if (this.clientHistory.length > 200) this.clientHistory.shift();
    this.listeners.forEach(fn => fn(entry));
  }

  getHistory(): SystemLogEntry[] {
    return [...this.clientHistory];
  }

  clear() {
    this.clientHistory = [];
  }
}

export const logBus = new EventBus();

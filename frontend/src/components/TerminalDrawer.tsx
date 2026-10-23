import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal, ChevronDown, ChevronUp, Trash2, Copy, Pause, Play,
  Search, Shield, Server, Cpu, Check, Maximize2, Minimize2
} from 'lucide-react';
import { api, type SystemLogEntry } from '@/services/api';
import { logBus } from '@/services/logger';

export default function TerminalDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [activeFilter, setActiveFilter] = useState<'all' | 'backend' | 'crypto' | 'kem' | 'security' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Subscribe to client-side crypto events
  useEffect(() => {
    // Add existing history
    const initialClientLogs = logBus.getHistory();
    initialClientLogs.forEach(entry => seenIdsRef.current.add(entry.id));
    setLogs(prev => [...initialClientLogs, ...prev]);

    const unsubscribe = logBus.subscribe((entry) => {
      if (!seenIdsRef.current.has(entry.id)) {
        seenIdsRef.current.add(entry.id);
        setLogs(prev => [...prev.slice(-300), entry]);
      }
    });

    return unsubscribe;
  }, []);

  // Poll backend relay logs periodically
  useEffect(() => {
    let active = true;

    const fetchBackendLogs = async () => {
      try {
        const res = await api.systemLogs(100);
        if (!active || !res.logs) return;

        setLogs(prev => {
          const newEntries: SystemLogEntry[] = [];
          for (const item of res.logs) {
            if (!seenIdsRef.current.has(item.id)) {
              seenIdsRef.current.add(item.id);
              newEntries.push(item);
            }
          }
          if (newEntries.length === 0) return prev;
          const merged = [...prev, ...newEntries];
          return merged.slice(-400);
        });
      } catch {
        // Silently retry on next tick
      }
    };

    fetchBackendLogs();
    const interval = setInterval(fetchBackendLogs, 1500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && isOpen && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isOpen, autoScroll]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Filter tab
      if (activeFilter === 'backend' && log.source !== 'backend') return false;
      if (activeFilter === 'crypto' && log.level !== 'CRYPTO') return false;
      if (activeFilter === 'kem' && log.level !== 'KEM') return false;
      if (activeFilter === 'security' && log.level !== 'SECURITY') return false;
      if (activeFilter === 'error' && log.level !== 'ERROR' && log.level !== 'WARN') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          log.message.toLowerCase().includes(q) ||
          log.logger.toLowerCase().includes(q) ||
          log.level.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, activeFilter, searchQuery]);

  const handleCopy = () => {
    const text = filteredLogs
      .map(l => `[${l.timestamp}] [${l.level.padEnd(8)}] [${l.logger}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    seenIdsRef.current.clear();
    setLogs([]);
    logBus.clear();
  };

  const getLevelBadgeClass = (level: string) => {
    switch (level.toUpperCase()) {
      case 'SECURITY':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'KEM':
        return 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30';
      case 'CRYPTO':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case 'WARN':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'ERROR':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      default:
        return 'text-slate-400 bg-slate-800 border-white/10';
    }
  };

  return (
    <>
      {/* Floating Toggle Button (visible when drawer is closed) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-navy-900/95 hover:bg-navy-800 border border-cyan-500/40 text-cyan-400 shadow-2xl backdrop-blur transition-all hover:scale-105 group font-mono text-xs font-semibold"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Terminal className="w-4 h-4 text-cyan-400 group-hover:rotate-6 transition-transform" />
          <span>Live Console</span>
          <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px]">
            {logs.length}
          </span>
        </button>
      )}

      {/* Terminal Drawer */}
      {isOpen && (
        <div
          className={`fixed bottom-0 right-0 z-50 bg-navy-950/95 border-t border-l border-white/10 shadow-2xl backdrop-blur-md flex flex-col transition-all duration-200 ${
            isMaximized ? 'inset-0' : 'left-0 lg:left-64 h-80 sm:h-96'
          }`}
        >
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-navy-900 border-b border-white/10 select-none">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono font-bold text-white tracking-wider uppercase">
                  QuantumShield Live Console & Security Audit
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                ({filteredLogs.length} events)
              </span>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
                className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
                  autoScroll
                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                    : 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                }`}
              >
                {autoScroll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span className="text-[10px] hidden md:inline font-mono">
                  {autoScroll ? 'Auto' : 'Paused'}
                </span>
              </button>

              <button
                onClick={handleCopy}
                title="Copy all visible logs"
                className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={handleClear}
                title="Clear console output"
                className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setIsMaximized(!isMaximized)}
                title={isMaximized ? 'Restore height' : 'Maximize window'}
                className="p-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => setIsOpen(false)}
                title="Minimize console"
                className="p-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Subheader Filters & Search */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-navy-900/60 border-b border-white/5">
            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-mono">
              {[
                { id: 'all', label: 'All Logs', icon: Terminal },
                { id: 'backend', label: 'Backend Relay', icon: Server },
                { id: 'crypto', label: 'Classical ECDH', icon: Cpu },
                { id: 'kem', label: 'ML-KEM-768 (PQ)', icon: Shield },
                { id: 'security', label: 'Security & Auth', icon: Shield },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilter(tab.id as typeof activeFilter)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                    activeFilter === tab.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <tab.icon className="w-3 h-3" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative flex items-center">
              <Search className="w-3 h-3 text-slate-500 absolute left-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter logs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-xs font-mono bg-navy-950 border border-white/10 rounded-md text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 w-36 sm:w-48"
              />
            </div>
          </div>

          {/* Log Output Stream */}
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs select-text bg-navy-950/80"
          >
            {filteredLogs.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs italic">
                No logs match the current filter or search criteria.
              </div>
            ) : (
              filteredLogs.map(log => (
                <div
                  key={log.id}
                  className="flex items-start gap-2.5 leading-relaxed hover:bg-white/[0.02] px-1 py-0.5 rounded transition-colors group"
                >
                  {/* Timestamp */}
                  <span className="text-slate-500 text-[11px] select-none flex-shrink-0">
                    {log.timestamp}
                  </span>

                  {/* Source indicator */}
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded border uppercase font-bold flex-shrink-0 ${
                      log.source === 'backend'
                        ? 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30'
                        : 'text-teal-400 bg-teal-500/10 border-teal-500/30'
                    }`}
                  >
                    {log.source === 'backend' ? 'SRV' : 'CLI'}
                  </span>

                  {/* Level Badge */}
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold flex-shrink-0 ${getLevelBadgeClass(
                      log.level
                    )}`}
                  >
                    {log.level}
                  </span>

                  {/* Logger Name */}
                  <span className="text-slate-400 text-[11px] flex-shrink-0 opacity-80">
                    [{log.logger}]
                  </span>

                  {/* Log Message */}
                  <span
                    className={`break-all ${
                      log.level === 'SECURITY'
                        ? 'text-emerald-300 font-medium'
                        : log.level === 'KEM'
                        ? 'text-fuchsia-300 font-medium'
                        : log.level === 'CRYPTO'
                        ? 'text-cyan-300 font-medium'
                        : log.level === 'WARN'
                        ? 'text-amber-300'
                        : log.level === 'ERROR'
                        ? 'text-red-300 font-bold'
                        : 'text-slate-200'
                    }`}
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

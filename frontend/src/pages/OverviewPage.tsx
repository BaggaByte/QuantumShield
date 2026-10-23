import React, { useEffect, useState } from "react";
import {
  Shield, Wifi, WifiOff, Lock, Key, Hash, Users, AlertTriangle,
  ChevronRight, Zap, Activity
} from "lucide-react";
import { api } from "@/services/api";
import type { HealthResponse, SecurityStatus } from "@/services/api";

interface Props {
  onNavigate: (page: string) => void;
  globalSession?: { mode: string; sessionId?: string; handshakeComplete?: boolean; roomId?: string; participantCount?: number } | null;
}

export default function OverviewPage({ onNavigate, globalSession }: Props) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendOnline, setBackendOnline] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [h, s] = await Promise.all([api.health(), api.securityStatus()]);
        setHealth(h);
        setSecurity(s);
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${ok
      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
      : "bg-red-500/10 border-red-500/30 text-red-400"
    }`}>
      <div className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
      {label}
    </div>
  );

  const StatCard = ({ icon: Icon, label, value, sub }: {
    icon: React.ElementType; label: string; value: string | number; sub?: string
  }) => (
    <div className="bg-navy-800 border border-white/10 rounded-xl p-5 flex items-start gap-4 hover:border-cyan-500/30 transition-colors">
      <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
        <Icon className="w-5 h-5 text-cyan-400" />
      </div>
      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-xl font-semibold text-white font-mono">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 glow-border">
            <Shield className="w-8 h-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">QuantumShield</h1>
            <p className="text-slate-400 text-sm">Hybrid Post-Quantum Secure Messaging</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="px-3 py-1.5 rounded-full bg-slate-700 text-slate-400 text-xs animate-pulse">Checking…</div>
          ) : (
            <StatusBadge ok={backendOnline} label={backendOnline ? "Backend Online" : "Backend Offline"} />
          )}
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Wifi} label="Connection" value={backendOnline ? "Live" : "Offline"} sub={backendOnline ? `${health?.uptime_seconds?.toFixed(0)}s uptime` : "Check backend"} />
        <StatCard icon={Key} label="Crypto Mode" value={globalSession?.mode ?? "Not set"} sub="Select in Secure Chat" />
        <StatCard icon={Hash} label="Session" value={globalSession?.sessionId ? globalSession.sessionId.slice(0, 12) + "…" : "None"} sub={globalSession?.handshakeComplete ? "Established" : "Not started"} />
        <StatCard icon={Users} label="Active Rooms" value={health?.rooms_active ?? "—"} sub={backendOnline ? "Live count" : "Unavailable"} />
      </div>

      {/* Security Status */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-navy-800 border border-white/10 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-400" />
            Security Architecture
          </h2>
          <div className="space-y-3">
            {[
              { label: "Server stores plaintext", value: security?.server_stores_plaintext ?? null, invert: true },
              { label: "Server stores session keys", value: security?.server_stores_keys ?? null, invert: true },
              { label: "Relay-only mode", value: security?.relay_only ?? null, invert: false },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-sm text-slate-400">{item.label}</span>
                {item.value === null ? (
                  <span className="text-xs text-slate-500">—</span>
                ) : (
                  <StatusBadge
                    ok={item.invert ? !item.value : !!item.value}
                    label={item.value ? "YES" : "NO"}
                  />
                )}
              </div>
            ))}
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-slate-400">Supported modes</span>
              <div className="flex gap-2">
                {security?.supported_modes.map(m => (
                  <span key={m} className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded">{m}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Quantum Threat Model */}
        <div className="bg-navy-800 border border-amber-500/20 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Quantum Threat Model
          </h2>
          <div className="space-y-3 text-sm text-slate-400">
            <p>
              <span className="text-amber-400 font-medium">Harvest Now, Decrypt Later:</span> Adversaries capture today's
              encrypted traffic to decrypt once cryptographically-relevant quantum computers exist.
            </p>
            <p>
              <span className="text-cyan-400 font-medium">Hybrid Protection:</span> Combining X25519 (classical) and
              ML-KEM-768 (post-quantum) ensures that breaking either alone is insufficient.
            </p>
            <p>
              <span className="text-slate-500 font-medium">Note:</span> Hybrid key exchange does not provide
              authentication, forward secrecy beyond the session, or endpoint security without additional controls.
            </p>
          </div>
        </div>
      </div>

      {/* Session Info */}
      {globalSession && (
        <div className="bg-navy-800 border border-white/10 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Current Session
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-slate-500 text-xs mb-1">Room</p><p className="text-white font-mono">{globalSession.roomId ?? "—"}</p></div>
            <div><p className="text-slate-500 text-xs mb-1">Mode</p><p className="text-cyan-400 font-mono">{globalSession.mode}</p></div>
            <div><p className="text-slate-500 text-xs mb-1">Participants</p><p className="text-white font-mono">{globalSession.participantCount ?? 0}</p></div>
            <div><p className="text-slate-500 text-xs mb-1">Handshake</p><p className={globalSession.handshakeComplete ? "text-emerald-400 font-mono" : "text-amber-400 font-mono"}>{globalSession.handshakeComplete ? "Complete" : "Pending"}</p></div>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => onNavigate("chat")}
          className="group flex items-center justify-between p-5 bg-gradient-to-r from-cyan-500/10 to-teal-500/10 border border-cyan-500/30 rounded-xl hover:border-cyan-400/60 transition-all">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20"><Lock className="w-5 h-5 text-cyan-400" /></div>
            <div className="text-left">
              <p className="text-white font-semibold">Secure Chat</p>
              <p className="text-slate-400 text-sm">End-to-end encrypted messaging</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-cyan-400 transition-colors" />
        </button>

        <button onClick={() => onNavigate("benchmark")}
          className="group flex items-center justify-between p-5 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/30 rounded-xl hover:border-violet-400/60 transition-all">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/20"><Zap className="w-5 h-5 text-violet-400" /></div>
            <div className="text-left">
              <p className="text-white font-semibold">Benchmark Laboratory</p>
              <p className="text-slate-400 text-sm">Measure crypto performance</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-violet-400 transition-colors" />
        </button>
      </div>

      {/* Disclaimer */}
      {security && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-xs text-slate-400">
          <span className="text-amber-400 font-medium">? Disclaimer: </span>
          {security.disclaimer}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from "react";
import {
  Shield, MessageSquare, FlaskConical, Zap, CheckSquare, Menu, X, Smartphone
} from "lucide-react";
import OverviewPage from "@/pages/OverviewPage";
import ChatPage from "@/pages/ChatPage";
import ExplorerPage from "@/pages/ExplorerPage";
import BenchmarkPage from "@/pages/BenchmarkPage";
import SecurityTestPage from "@/pages/SecurityTestPage";
import TerminalDrawer from "@/components/TerminalDrawer";
import IdentitySetup from "@/components/IdentitySetup";
import IdentityCard from "@/components/IdentityCard";
import { useIdentity } from "@/hooks/useIdentity";
import { pushService } from "@/services/PushNotificationService";

type Page = "overview" | "chat" | "explorer" | "benchmark" | "tests";

const NAV_ITEMS: { id: Page; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: Shield },
  { id: "chat", label: "Secure Chat", icon: MessageSquare },
  { id: "explorer", label: "Crypto Explorer", icon: FlaskConical },
  { id: "benchmark", label: "Benchmark Lab", icon: Zap },
  { id: "tests", label: "Security Tests", icon: CheckSquare },
];

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalSession, setGlobalSession] = useState<{
    mode: string; sessionId?: string; handshakeComplete?: boolean; roomId?: string; participantCount?: number;
  } | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const { identity, status, create, setAlias, exportJSON, destroy } = useIdentity();

  useEffect(() => {
    setCanInstall(pushService.canInstallPwa());
    const onCanInstall = () => setCanInstall(true);
    const onInstalled = () => setCanInstall(false);

    window.addEventListener("qs-can-install-pwa", onCanInstall);
    window.addEventListener("qs-pwa-installed", onInstalled);

    return () => {
      window.removeEventListener("qs-can-install-pwa", onCanInstall);
      window.removeEventListener("qs-pwa-installed", onInstalled);
    };
  }, []);

  return (
    <div className="min-h-screen bg-navy-950 text-white flex">
      {/* Identity onboarding — shown only when no identity exists */}
      {status === 'none' && (
        <IdentitySetup onComplete={async (alias) => { await create(alias); }} />
      )}
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-navy-900 border-r border-white/5 flex flex-col transform transition-transform duration-300 lg:translate-x-0 lg:relative lg:z-auto ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
              <Shield className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <p className="font-bold text-white">QuantumShield</p>
              <p className="text-xs text-slate-400">Hybrid PQ Messaging</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => { setPage(item.id); setMobileOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${page === item.id
                ? "bg-cyan-500/10 border border-cyan-500/30 text-cyan-400"
                : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}>
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Session pill */}
        {globalSession && (
          <div className="p-4 border-t border-white/5">
            <div className="bg-navy-800 rounded-xl p-3 space-y-1">
              <p className="text-xs text-slate-500 uppercase tracking-wider">Active Session</p>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${globalSession.handshakeComplete ? "bg-emerald-400" : "bg-amber-400"} animate-pulse`} />
                <span className="text-xs text-white font-mono">{globalSession.roomId}</span>
              </div>
              <p className="text-xs text-cyan-400 capitalize">{globalSession.mode} mode</p>
            </div>
          </div>
        )}

        {/* Identity Card */}
        {identity && (
          <IdentityCard
            identity={identity}
            onAliasChange={setAlias}
            onExport={exportJSON}
            onDelete={destroy}
          />
        )}

        {/* PWA Install Button */}
        {canInstall && (
          <div className="px-4 pb-3">
            <button
              onClick={() => pushService.promptInstallPwa()}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 hover:from-cyan-500/30 hover:to-indigo-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-bold transition-all shadow-lg shadow-cyan-950/50"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Install PWA App</span>
            </button>
          </div>
        )}

        {/* Version */}
        <div className="px-4 pb-4">
          <p className="text-[10px] text-slate-600">QuantumShield v2.0 · Post-Quantum PWA</p>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-30 bg-navy-950/80 backdrop-blur border-b border-white/5 px-4 py-3 flex items-center justify-between">
          <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden p-2 rounded-lg border border-white/10 text-slate-400 hover:text-white">
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2 lg:ml-0">
            <span className="text-sm font-medium text-white">{NAV_ITEMS.find(n => n.id === page)?.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {globalSession?.handshakeComplete && (
              <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400 font-mono">{globalSession.roomId}</span>
              </div>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
          {page === "overview" && <OverviewPage onNavigate={(p) => setPage(p as Page)} globalSession={globalSession} />}
          {page === "chat" && <ChatPage onSessionChange={setGlobalSession} identity={identity} />}
          {page === "explorer" && <ExplorerPage />}
          {page === "benchmark" && <BenchmarkPage />}
          {page === "tests" && <SecurityTestPage />}
        </main>
      </div>

      {/* Live System & Cryptographic Console */}
      <TerminalDrawer />
    </div>
  );
}

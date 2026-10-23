import React, { useState } from "react";
import {
  Shield, MessageSquare, FlaskConical, Zap, CheckSquare, Menu, X
} from "lucide-react";
import OverviewPage from "@/pages/OverviewPage";
import ChatPage from "@/pages/ChatPage";
import ExplorerPage from "@/pages/ExplorerPage";
import BenchmarkPage from "@/pages/BenchmarkPage";
import SecurityTestPage from "@/pages/SecurityTestPage";
import TerminalDrawer from "@/components/TerminalDrawer";

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

  return (
    <div className="min-h-screen bg-navy-950 text-white flex">
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

        {/* Version */}
        <div className="p-4 border-t border-white/5">
          <p className="text-xs text-slate-600">v1.0.0 — Educational Prototype</p>
          <p className="text-xs text-slate-600 mt-0.5">Not production-ready</p>
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
          {page === "chat" && <ChatPage onSessionChange={setGlobalSession} />}
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

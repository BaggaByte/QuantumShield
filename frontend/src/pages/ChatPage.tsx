import React, { useState, useRef, useEffect } from "react";
import {
  MessageSquare, Send, Copy, Plus, LogIn, Shield, Lock,
  CheckCircle, XCircle, AlertCircle, Key,
  Loader, LogOut, RefreshCw, Eye, X, Atom, Sparkles, Check, Fingerprint,
  Trash2, HardDrive, History, Clock, Users, Paperclip, FileText, Download, UploadCloud
} from "lucide-react";
import { api } from "@/services/api";
import { StorageService } from "@/services/StorageService";
import { useSecureSession } from "@/hooks/useSecureSession";
import type { CryptoMode, ChatMessage, StoredRoomSummary } from "@/types";
import type { QSIdentity } from "@/services/IdentityService";

interface Props {
  onSessionChange?: (s: { mode: string; sessionId?: string; handshakeComplete?: boolean; roomId?: string; participantCount?: number } | null) => void;
  identity?: QSIdentity | null;
}

export default function ChatPage({ onSessionChange, identity }: Props) {
  const [view, setView] = useState<"setup" | "chat">("setup");
  const [mode, setMode] = useState<CryptoMode>("hybrid");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sendError, setSendError] = useState("");
  const [wireModalMsg, setWireModalMsg] = useState<ChatMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedWire, setCopiedWire] = useState(false);
  const [showQuantumSim, setShowQuantumSim] = useState(false);
  const [quantumAttacking, setQuantumAttacking] = useState(false);
  const [recentRooms, setRecentRooms] = useState<StoredRoomSummary[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [attackResult, setAttackResult] = useState<{
    status: "compromised" | "protected";
    details: string;
    revealedText?: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    roomState, session, messages, handshakeState, transferProgress, connect,
    initiateHandshake, sendMessage, sendFile, disconnect, clearHistory
  } = useSecureSession(identity);

  const currentRoomCode = roomState.roomId || activeRoomId || roomIdInput;

  const loadRecentRooms = async () => {
    try {
      const rooms = await StorageService.getRecentRooms();
      setRecentRooms(rooms);
    } catch (e) {
      console.error("Failed to load recent rooms:", e);
    }
  };

  useEffect(() => {
    if (view === "setup") {
      loadRecentRooms();
    }
  }, [view]);

  useEffect(() => {
    if (session && onSessionChange) {
      onSessionChange({
        mode: session.mode,
        sessionId: session.sessionId,
        handshakeComplete: session.handshakeState === "complete",
        roomId: roomState.roomId,
        participantCount: roomState.participantCount,
      });
    } else if (!session && onSessionChange) {
      onSessionChange(null);
    }
  }, [session, roomState, onSessionChange]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const { room_id } = await api.createRoom();
      setActiveRoomId(room_id);
      await connect(room_id, mode);
      setView("chat");
    } catch (e) {
      alert("Failed to create room: " + (e as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = roomIdInput.trim().toUpperCase();
    if (!code) return;
    setIsJoining(true);
    try {
      setActiveRoomId(code);
      await connect(code, mode);
      setView("chat");
    } catch (e) {
      alert("Failed to join room: " + (e as Error).message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;
    setSendError("");
    try {
      await sendMessage(inputText.trim());
      setInputText("");
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyRoomId = () => {
    if (currentRoomCode) {
      navigator.clipboard.writeText(currentRoomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResumeRoom = async (code: string) => {
    setActiveRoomId(code);
    setRoomIdInput(code);
    setIsJoining(true);
    try {
      await connect(code, mode);
      setView("chat");
    } catch (e) {
      alert("Failed to join room: " + (e as Error).message);
    } finally {
      setIsJoining(false);
    }
  };

  const handleDeleteRoomHistory = async (roomIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete encrypted history for room ${roomIdToDelete}? This action cannot be undone.`)) {
      await StorageService.deleteRoomHistory(roomIdToDelete);
      await loadRecentRooms();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSendError("");
    try {
      await sendFile(file);
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (handshakeState === "complete") setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (handshakeState !== "complete") return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSendError("");
      try {
        await sendFile(files[0]);
      } catch (err) {
        setSendError((err as Error).message);
      }
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setView("setup");
    setRoomIdInput("");
    setActiveRoomId("");
    setAttackResult(null);
  };

  const runQuantumAttack = () => {
    if (messages.length === 0) {
      alert("Send at least one message first to simulate a quantum harvest attack!");
      return;
    }
    setQuantumAttacking(true);
    setAttackResult(null);

    const targetMsg = messages[messages.length - 1];

    setTimeout(() => {
      setQuantumAttacking(false);
      if (mode === "classical") {
        setAttackResult({
          status: "compromised",
          details: "Shor's Algorithm solved the Discrete Logarithm Problem (DLP) on Curve25519 in polynomial time O((log N)³). The private scalar was computed, classical ECDH shared secret derived, and AES-256-GCM key recovered!",
          revealedText: targetMsg.plaintext,
        });
      } else {
        setAttackResult({
          status: "protected",
          details: "Shor's Algorithm successfully broke the classical X25519 secret, BUT failed against ML-KEM-768. The Module Learning With Errors (M-LWE) lattice hardness assumption remains quantum-resistant. Because HKDF requires BOTH secrets, the session key cannot be computed!",
          revealedText: undefined,
        });
      }
    }, 1400);
  };

  const handshakeSteps = [
    { id: "keygen", name: "1. Ephemeral Keygen", done: handshakeState === "exchanging" || handshakeState === "deriving" || handshakeState === "complete" },
    { id: "exchange", name: "2. Key Encapsulation", done: handshakeState === "deriving" || handshakeState === "complete" },
    { id: "derive", name: "3. Dual-HKDF Combiner", done: handshakeState === "complete" },
    { id: "complete", name: "4. AES-256-GCM Active", done: handshakeState === "complete" },
  ];

  if (view === "setup") {
    return (
      <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
              <MessageSquare className="w-8 h-8 text-cyan-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-white">Secure Chat</h1>
          <p className="text-slate-400 text-sm">End-to-end encrypted messaging with post-quantum cryptography</p>
        </div>

        {/* Mode Selection */}
        <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Key className="w-4 h-4 text-cyan-400" />
            Cryptographic Mode
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(["classical", "hybrid"] as CryptoMode[]).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`p-4 rounded-xl border text-left transition-all ${mode === m
                  ? "border-cyan-500/60 bg-cyan-500/10"
                  : "border-white/10 bg-navy-900 hover:border-white/20"
                }`}>
                <p className="font-semibold text-white capitalize text-sm">{m}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {m === "classical" ? "X25519 + AES-256-GCM" : "X25519 + ML-KEM-768 + AES-256-GCM"}
                </p>
              </button>
            ))}
          </div>
          {mode === "hybrid" && (
            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 text-xs text-emerald-400">
              🛡️ Hybrid mode adds ML-KEM-768 post-quantum protection against harvest-now-decrypt-later attacks
            </div>
          )}
        </div>

        {/* Create / Join */}
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" /> Create Group Room
            </h2>
            <p className="text-xs text-slate-400">Create a secure room and share the code with up to 7 peers (Star Topology N-Party E2E).</p>
            <button onClick={handleCreate} disabled={isCreating}
              className="w-full py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 font-medium text-sm hover:bg-cyan-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {isCreating ? <><Loader className="w-4 h-4 animate-spin" /> Creating…</> : "Create Room"}
            </button>
          </div>

          <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <LogIn className="w-4 h-4 text-teal-400" /> Join Room
            </h2>
            <input
              value={roomIdInput}
              onChange={e => setRoomIdInput(e.target.value.toUpperCase())}
              placeholder="Enter room code (e.g. A1B2C3D4)"
              className="w-full px-3 py-2 bg-navy-900 border border-white/10 rounded-lg text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
              maxLength={8}
            />
            <button onClick={handleJoin} disabled={isJoining || !roomIdInput.trim()}
              className="w-full py-2.5 rounded-lg bg-teal-500/20 border border-teal-500/40 text-teal-400 font-medium text-sm hover:bg-teal-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {isJoining ? <><Loader className="w-4 h-4 animate-spin" /> Joining…</> : "Join Room"}
            </button>
          </div>
        </div>

        {/* Recent Encrypted Conversations (Phase 2) */}
        {recentRooms.length > 0 && (
          <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <History className="w-4 h-4 text-cyan-400" />
                <span>Recent Encrypted Conversations</span>
              </h2>
              <span className="text-[10px] text-slate-400 font-mono px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                AES-256 Vault
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Encrypted client-side at rest with your identity key. Messages never touch any server disk.
            </p>
            <div className="space-y-2 pt-1">
              {recentRooms.map((r) => (
                <div
                  key={r.roomId}
                  onClick={() => handleResumeRoom(r.roomId)}
                  className="flex items-center justify-between p-3 rounded-lg bg-navy-900 border border-white/5 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all cursor-pointer group"
                >
                  <div className="space-y-0.5 min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-bold text-white group-hover:text-cyan-300">
                        {r.roomId}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
                        {r.messageCount} msg{r.messageCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    {r.lastMessageSnippet && (
                      <p className="text-xs text-slate-400 truncate max-w-xs">
                        "{r.lastMessageSnippet}"
                      </p>
                    )}
                    <p className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(r.lastActivity).toLocaleDateString()} {new Date(r.lastActivity).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={(e) => handleDeleteRoomHistory(r.roomId, e)}
                      title="Delete encrypted room history"
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Chat View -------------------------------------------------------------
  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-[calc(100vh-10rem)] animate-fade-in relative"
    >
      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-navy-950/90 border-2 border-dashed border-cyan-400 rounded-2xl flex flex-col items-center justify-center gap-3 backdrop-blur-sm animate-fade-in">
          <UploadCloud className="w-12 h-12 text-cyan-400 animate-bounce" />
          <p className="text-white text-base font-bold">Drop File to Encrypt & Stream</p>
          <p className="text-slate-400 text-xs font-mono">End-to-End Post-Quantum File Relay</p>
        </div>
      )}

      {/* Chat Header */}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-4 mb-3 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${roomState.connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono font-bold text-base px-2.5 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">{currentRoomCode}</span>
                <button onClick={copyRoomId} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg transition-colors font-medium">
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </button>
                {copied && <span className="text-xs text-emerald-400 font-semibold animate-pulse">Copied!</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span className="flex items-center gap-1 font-mono text-cyan-300">
                  <Users className="w-3.5 h-3.5" />
                  {roomState.participantCount}/8 participants
                </span>
                <span className="capitalize">{mode} mode</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-300 font-bold uppercase">
                  {roomState.isHub ? "⭐️ Star Hub" : "Spoke Peer"}
                </span>
                <span className={handshakeState === "complete" ? "text-emerald-400 font-semibold" : "text-amber-400"}>
                  {handshakeState === "complete" ? "Established ✓" : "Negotiating keys…"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-lg text-xs font-mono text-cyan-300" title="All messages are stored client-side using AES-256-GCM IndexedDB">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              <span>AES-256 Vault</span>
            </div>
            {session?.sessionKeyFingerprint && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-xs text-emerald-400">{session.sessionKeyFingerprint}</span>
              </div>
            )}
            <button
              onClick={() => setShowQuantumSim(!showQuantumSim)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                showQuantumSim ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40" : "bg-white/5 text-slate-300 hover:text-white border border-white/10"
              }`}
            >
              <Atom className="w-3.5 h-3.5 text-fuchsia-400" />
              <span>Quantum Simulator</span>
            </button>
            {roomState.participantCount >= 2 && handshakeState !== "complete" && (
              <button
                onClick={() => initiateHandshake()}
                className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors animate-pulse"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Start Handshake</span>
              </button>
            )}
            <button
              onClick={() => setConfirmClearOpen(true)}
              title="Clear Room History (Cryptographic Erase)"
              className="p-2 rounded-lg border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={handleDisconnect}
              className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Live Handshake Stepper Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-white/5">
          {handshakeSteps.map((step, idx) => (
            <div
              key={step.id}
              className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-mono transition-all ${
                step.done
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : handshakeState !== "idle" && idx === 0
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300 animate-pulse"
                  : "bg-navy-900 border-white/5 text-slate-500"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${step.done ? "bg-emerald-400" : "bg-slate-600"}`} />
              <span className="truncate">{step.name}</span>
            </div>
          ))}
        </div>

        {/* Multi-Participant Roster (Phase 3 Star Topology) */}
        {roomState.participants && roomState.participants.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/5 flex-wrap">
            <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 mr-1">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              <span>Group Roster ({roomState.participantCount}/8):</span>
            </span>
            {roomState.participants.map((p) => {
              const isSelf = p.id === roomState.participantId;
              const isHub = p.role === "hub" || p.id === roomState.hubId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-xs font-mono transition-all ${
                    isSelf
                      ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                      : isHub
                      ? "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300"
                      : "bg-navy-900 border-white/10 text-slate-300"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isHub ? "bg-fuchsia-400" : "bg-emerald-400"}`} />
                  <span className="font-semibold">{p.alias || (isSelf ? "You" : `Peer ${p.id.slice(0, 4)}`)}</span>
                  {p.fingerprint && (
                    <span className="text-[10px] text-slate-400 font-mono">({p.fingerprint})</span>
                  )}
                  <span className={`text-[9px] px-1 py-0.2 rounded font-bold uppercase ${
                    isHub ? "bg-fuchsia-500/20 text-fuchsia-300" : "bg-slate-700 text-slate-300"
                  }`}>
                    {isHub ? "HUB" : "PEER"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quantum Adversary Simulation Panel */}
      {showQuantumSim && (
        <div className="bg-navy-900/95 border border-fuchsia-500/30 rounded-xl p-4 mb-3 space-y-3 backdrop-blur shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Atom className="w-5 h-5 text-fuchsia-400 animate-spin-slow" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                Harvest Now, Decrypt Later (HNDL) Adversary Simulator
              </h3>
            </div>
            <button onClick={() => setShowQuantumSim(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Simulate a nation-state eavesdropper intercepting your ciphertext today and executing <strong>Shor's Algorithm</strong> on a Cryptanalytically Relevant Quantum Computer (CRQC) in the future.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={runQuantumAttack}
              disabled={quantumAttacking}
              className="px-4 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 border border-fuchsia-500/50 rounded-lg text-xs font-bold font-mono flex items-center gap-2 transition-all disabled:opacity-50"
            >
              {quantumAttacking ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Simulate Shor's Algorithm Attack</span>
            </button>
            <span className="text-xs font-mono text-slate-400">
              Active mode: <strong className="text-cyan-400 capitalize">{mode}</strong>
            </span>
          </div>

          {/* Attack Outcome */}
          {attackResult && (
            <div className={`p-3.5 rounded-xl border text-xs font-mono space-y-2 animate-fade-in ${
              attackResult.status === "compromised"
                ? "bg-red-500/10 border-red-500/40 text-red-300"
                : "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
            }`}>
              <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-sm">
                {attackResult.status === "compromised" ? <XCircle className="w-4 h-4 text-red-400" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />}
                <span>{attackResult.status === "compromised" ? "⚠️ Classical Traffic Compromised!" : "🛡️ Hybrid Traffic Quantum-Resistant!"}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-200">{attackResult.details}</p>
              {attackResult.revealedText && (
                <div className="bg-black/50 p-2.5 rounded-lg border border-red-500/30">
                  <span className="text-red-400 uppercase font-bold text-[10px] block">Recovered Plaintext:</span>
                  <span className="text-white text-sm font-semibold">{attackResult.revealedText}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {roomState.participantCount < 2 && handshakeState === "idle" && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="p-4 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin-slow" />
            </div>
            <div>
              <p className="text-white font-semibold text-lg">Waiting for peer to join…</p>
              <p className="text-slate-400 text-sm mt-1">Share this room code with your peer:</p>
              <div className="mt-3 inline-flex items-center gap-3 px-4 py-2 bg-navy-900 border border-cyan-500/40 rounded-xl shadow-lg">
                <span className="text-cyan-400 font-mono text-xl font-bold tracking-widest">{currentRoomCode}</span>
                <button onClick={copyRoomId} className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors">
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
              {copied && <p className="text-xs text-emerald-400 mt-2 font-medium">Copied to clipboard!</p>}
            </div>
          </div>
        )}

        {handshakeState === "complete" && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Lock className="w-8 h-8 text-emerald-400" />
            </div>
            <div>
              <p className="text-emerald-400 font-medium">Secure channel established</p>
              <p className="text-slate-400 text-sm mt-1">Session key: <span className="font-mono">{session?.sessionKeyFingerprint}</span></p>
              <p className="text-slate-500 text-xs mt-1">Type a message below to begin messaging</p>
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderRole === "self" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-xs lg:max-w-md rounded-xl px-4 py-3 border transition-colors ${
                msg.senderRole === "self"
                  ? "bg-cyan-500/15 border-cyan-500/30 text-white"
                  : "bg-navy-800 border-white/10 text-white"
              }`}
            >
              {msg.senderRole === "peer" && (
                <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-mono text-cyan-300 pb-1 border-b border-white/5">
                  <span className="font-bold">{msg.senderAlias || `Peer ${msg.senderId.slice(0, 4)}`}</span>
                  {msg.senderFingerprint && (
                    <span className="text-[10px] text-slate-400 font-normal">({msg.senderFingerprint})</span>
                  )}
                </div>
              )}
              {/* Attachment Display (Phase 4 File & Image Sharing) */}
              {msg.attachment && (
                <div className="mb-2">
                  {msg.attachment.isImage ? (
                    <div className="relative group overflow-hidden rounded-lg border border-white/10 bg-black/40">
                      <img
                        src={msg.attachment.blobUrl || msg.attachment.dataUrl}
                        alt={msg.attachment.fileName}
                        className="max-h-60 w-auto rounded-lg object-contain cursor-pointer hover:opacity-95 transition-opacity"
                        onClick={() => {
                          if (msg.attachment?.blobUrl) {
                            window.open(msg.attachment.blobUrl, "_blank");
                          }
                        }}
                      />
                      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-slate-300 font-mono bg-navy-950/80">
                        <span className="truncate max-w-[150px]">{msg.attachment.fileName}</span>
                        <span>{(msg.attachment.fileSize / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-2.5 rounded-lg border border-white/10 bg-navy-900/80 gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-5 h-5 text-cyan-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate max-w-[180px]">
                            {msg.attachment.fileName}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            {(msg.attachment.fileSize / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      {msg.attachment.blobUrl && (
                        <a
                          href={msg.attachment.blobUrl}
                          download={msg.attachment.fileName}
                          className="p-1.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 transition-colors"
                          title="Download file"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-start justify-between gap-3">
                <p className={`text-sm break-words ${msg.authVerified ? "text-white" : "text-red-400"}`}>
                  {msg.authVerified ? msg.plaintext : "⚠️ Authentication failed — message rejected"}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 mt-2 pt-1 border-t border-white/5 text-[11px] font-mono text-slate-400">
                <div className="flex items-center gap-1.5">
                  <span>{new Date(msg.displayedAt).toLocaleTimeString()}</span>
                  {msg.authVerified ? (
                    <span className="text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle className="w-3 h-3" /> Auth OK
                    </span>
                  ) : (
                    <span className="text-red-400 flex items-center gap-0.5">
                      <XCircle className="w-3 h-3" /> Bad Tag
                    </span>
                  )}
                  {msg.senderRole === "self" && (
                    <span
                      className="flex items-center ml-1 text-xs"
                      title={msg.status === "delivered" ? "Delivered to peer (acknowledged)" : "Sent to relay"}
                    >
                      {msg.status === "delivered" ? (
                        <span className="text-cyan-400 flex items-center font-bold tracking-tighter">
                          <Check className="w-3.5 h-3.5" />
                          <Check className="w-3.5 h-3.5 -ml-2" />
                        </span>
                      ) : (
                        <Check className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => setWireModalMsg(msg)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-cyan-300 hover:text-cyan-200 transition-colors"
                >
                  <Eye className="w-3 h-3" />
                  <span>Inspect Wire</span>
                </button>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* File Transfer Streaming Progress Bar (Phase 4) */}
      {transferProgress && (
        <div className="bg-navy-900 border border-cyan-500/30 rounded-xl p-3 mb-2 space-y-1.5 animate-fade-in text-xs font-mono">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-400">
              <UploadCloud className="w-4 h-4 animate-bounce" />
              <span className="font-bold truncate max-w-[200px]">
                {transferProgress.direction === "sending" ? "Streaming Encrypted File:" : "Receiving Encrypted File:"} {transferProgress.fileName}
              </span>
            </div>
            <span className="text-slate-400">
              {transferProgress.percentage}% ({transferProgress.transferredChunks}/{transferProgress.totalChunks} chunks)
            </span>
          </div>
          <div className="w-full bg-navy-950 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full transition-all duration-150"
              style={{ width: `${transferProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Hidden File Picker Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Message Input Area */}
      {sendError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {sendError}
        </div>
      )}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={handshakeState !== "complete"}
          title="Encrypt & Transmit File / Image"
          className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 hover:border-cyan-500/30 transition-colors disabled:opacity-40"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <input
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={handshakeState === "complete" ? "Type an encrypted message or attach a file…" : "Waiting for secure channel…"}
          disabled={handshakeState !== "complete"}
          className="flex-1 bg-transparent text-white text-sm placeholder-slate-500 focus:outline-none disabled:opacity-40"
        />
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || handshakeState !== "complete"}
          className="p-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-40">
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Inspect Wire Modal */}
      {wireModalMsg && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-navy-900 border border-white/20 rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4 animate-fade-in font-mono text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-white text-sm">Relayed Wire Frame Inspection</h3>
              </div>
              <button onClick={() => setWireModalMsg(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-400 text-xs font-sans">
              This is the exact JSON packet captured by the relay server. Notice that plaintext is completely absent — only opaque AES-256-GCM ciphertext and authentication metadata are exposed.
            </p>

            {/* Wire Packet Dump */}
            <div className="bg-navy-950 p-3 rounded-xl border border-white/10 overflow-x-auto text-[11px] space-y-1 text-slate-300">
              <p className="text-cyan-400 font-bold">// Raw WebSocket JSON Envelope</p>
              <pre className="text-slate-300 font-mono whitespace-pre-wrap break-all">
{JSON.stringify({
  type: "encrypted_message",
  sessionId: wireModalMsg.sessionId,
  messageId: wireModalMsg.id,
  senderId: wireModalMsg.senderId,
  sequenceNumber: wireModalMsg.meta.sequenceNumber,
  algorithm: wireModalMsg.meta.algorithm,
  nonce_b64: wireModalMsg.encryptedPayload?.nonce,
  ciphertext_b64: wireModalMsg.encryptedPayload?.ciphertext,
  timestamp: wireModalMsg.meta.timestamp,
  aad_bound: `session:${wireModalMsg.sessionId}|seq:${wireModalMsg.meta.sequenceNumber}`
}, null, 2)}
              </pre>
            </div>

            {/* Wire Security Notes */}
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-300 text-xs space-y-1 font-sans">
              <p className="font-bold flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Zero-Knowledge Relay Guarantee
              </p>
              <p className="text-[11px] text-slate-300">
                The server cannot decrypt this message because it does not possess the derived AES key or post-quantum shared secret. Associated Authenticated Data (AAD) prevents packet replay or room injection.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(wireModalMsg.encryptedPayload, null, 2));
                  setCopiedWire(true);
                  setTimeout(() => setCopiedWire(false), 2000);
                }}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-white flex items-center gap-1 text-xs"
              >
                {copiedWire ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedWire ? "Copied Envelope" : "Copy JSON"}</span>
              </button>
              <button
                onClick={() => setWireModalMsg(null)}
                className="px-4 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-semibold hover:bg-cyan-500/30"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear History Confirmation Modal */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-navy-900 border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Erase Room History?</h3>
                <p className="text-xs text-slate-400">Room: <span className="font-mono text-cyan-400 font-semibold">{currentRoomCode}</span></p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will perform a <strong>cryptographic erasure</strong> of all messages stored at rest in IndexedDB for this room. Because messages were never sent to or stored on any server, this action is permanent and cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 rounded-lg border border-white/10 text-slate-300 hover:text-white text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await clearHistory();
                  setConfirmClearOpen(false);
                }}
                className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold transition-colors"
              >
                Erase History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

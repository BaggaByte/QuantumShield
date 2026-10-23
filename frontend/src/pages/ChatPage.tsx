import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageSquare, Send, Copy, Plus, LogIn, Shield, Lock,
  CheckCircle, XCircle, AlertCircle, ChevronDown, Key,
  Loader, Info, LogOut, RefreshCw
} from "lucide-react";
import { api } from "@/services/api";
import { useSecureSession } from "@/hooks/useSecureSession";
import type { CryptoMode, ChatMessage } from "@/types";

interface Props {
  onSessionChange?: (s: { mode: string; sessionId?: string; handshakeComplete?: boolean; roomId?: string; participantCount?: number } | null) => void;
}

export default function ChatPage({ onSessionChange }: Props) {
  const [view, setView] = useState<"setup" | "chat">("setup");
  const [mode, setMode] = useState<CryptoMode>("hybrid");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [activeRoomId, setActiveRoomId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [inputText, setInputText] = useState("");
  const [sendError, setSendError] = useState("");
  const [selectedMsg, setSelectedMsg] = useState<ChatMessage | null>(null);
  const [copied, setCopied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { roomState, session, messages, handshakeState, connect, sendMessage, disconnect } = useSecureSession();
  const currentRoomCode = roomState.roomId || activeRoomId || roomIdInput;

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

  const handleDisconnect = () => {
    disconnect();
    setView("setup");
    setRoomIdInput("");
    setActiveRoomId("");
  };

  const handshakeColor = {
    idle: "text-slate-400", generating_keys: "text-amber-400",
    waiting_peer: "text-amber-400", exchanging: "text-blue-400",
    deriving: "text-blue-400", complete: "text-emerald-400", failed: "text-red-400",
  };

  const handshakeLabel = {
    idle: "Waiting…", generating_keys: "Generating keys…",
    waiting_peer: "Waiting for peer…", exchanging: "Exchanging keys…",
    deriving: "Deriving session key…", complete: "Established ?", failed: "Failed ?",
  };

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
              ?? Hybrid mode adds ML-KEM-768 post-quantum protection against harvest-now-decrypt-later attacks
            </div>
          )}
        </div>

        {/* Create / Join */}
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-navy-800 border border-white/10 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" /> Create Room
            </h2>
            <p className="text-xs text-slate-400">Create a new room and share the code with your peer.</p>
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
      </div>
    );
  }

  // --- Chat View -------------------------------------------------------------
  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] animate-fade-in">
      {/* Chat Header */}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${roomState.connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono font-bold text-base px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-lg">{currentRoomCode}</span>
                <button onClick={copyRoomId} className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg transition-colors font-medium">
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </button>
                {copied && <span className="text-xs text-emerald-400 font-semibold animate-pulse">Copied!</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                <span>{roomState.participantCount}/2 participants</span>
                <span className="capitalize">{mode} mode</span>
                <span className={handshakeColor[handshakeState]}>{handshakeLabel[handshakeState]}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session?.sessionKeyFingerprint && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-xs text-emerald-400">{session.sessionKeyFingerprint}</span>
              </div>
            )}
            <button onClick={handleDisconnect}
              className="p-2 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* Algorithm badges */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {["X25519", mode === "hybrid" ? "ML-KEM-768" : null, "HKDF-SHA-256", "AES-256-GCM"].filter(Boolean).map(alg => (
            <span key={alg} className="text-xs bg-navy-700 border border-white/10 text-slate-300 px-2 py-0.5 rounded font-mono">{alg}</span>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
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
        {handshakeState !== "idle" && handshakeState !== "complete" && (
          <div className="flex items-center justify-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <Loader className="w-5 h-5 text-blue-400 animate-spin" />
            <p className="text-blue-400 text-sm">{handshakeLabel[handshakeState]}</p>
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
              <p className="text-slate-500 text-xs mt-1">Type a message to begin</p>
            </div>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.senderRole === "self" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-xs lg:max-w-md group relative ${msg.senderRole === "self"
                ? "bg-cyan-500/15 border border-cyan-500/30"
                : "bg-navy-800 border border-white/10"
              } rounded-xl px-4 py-3 cursor-pointer hover:border-cyan-400/40 transition-colors`}
              onClick={() => setSelectedMsg(selectedMsg?.id === msg.id ? null : msg)}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm break-words ${msg.authVerified ? "text-white" : "text-red-400"}`}>
                  {msg.authVerified ? msg.plaintext : "? Authentication failed — message rejected"}
                </p>
                <button className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-xs text-slate-500">{new Date(msg.displayedAt).toLocaleTimeString()}</span>
                {msg.authVerified
                  ? <CheckCircle className="w-3 h-3 text-emerald-400" />
                  : <XCircle className="w-3 h-3 text-red-400" />
                }
              </div>
              {/* Message detail panel */}
              {selectedMsg?.id === msg.id && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-xs text-slate-400 font-mono">
                  <p><span className="text-slate-500">ID:</span> {msg.id.slice(0, 16)}…</p>
                  <p><span className="text-slate-500">Seq:</span> #{msg.meta.sequenceNumber}</p>
                  <p><span className="text-slate-500">Alg:</span> {msg.meta.algorithm}</p>
                  <p><span className="text-slate-500">Auth:</span> <span className={msg.authVerified ? "text-emerald-400" : "text-red-400"}>{msg.authVerified ? "Verified ?" : "FAILED ?"}</span></p>
                  {msg.meta.encryptDurationMs !== undefined && (
                    <p><span className="text-slate-500">Encrypt:</span> {msg.meta.encryptDurationMs.toFixed(3)}ms</p>
                  )}
                  {msg.meta.decryptDurationMs !== undefined && (
                    <p><span className="text-slate-500">Decrypt:</span> {msg.meta.decryptDurationMs.toFixed(3)}ms</p>
                  )}
                  <p><span className="text-slate-500">Nonce:</span> {msg.encryptedPayload?.nonce?.slice(0, 16)}…</p>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      {sendError && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {sendError}
        </div>
      )}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-3 flex items-center gap-3">
        <input
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={handshakeState === "complete" ? "Type an encrypted message…" : "Waiting for secure channel…"}
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
    </div>
  );
}

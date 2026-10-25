import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  MessageSquare, Send, Copy, Plus, LogIn, Shield, Lock,
  CheckCircle, XCircle, AlertCircle, Key,
  Loader, LogOut, RefreshCw, Eye, X, Check, Fingerprint,
  Trash2, HardDrive, History, Clock, Users, Paperclip, FileText, Download, UploadCloud,
  Bell, BellOff, Smartphone, Search, ChevronLeft, QrCode, User, Filter, ArrowRight, Globe,
  Volume2, VolumeX, Flame, RotateCw, ShieldCheck, Sparkles
} from "lucide-react";
import { api } from "@/services/api";
import { StorageService } from "@/services/StorageService";
import { pushService } from "@/services/PushNotificationService";
import { soundHapticService } from "@/services/SoundHapticService";
import { useSecureSession } from "@/hooks/useSecureSession";
import IdentityCard from "@/components/IdentityCard";
import AudioSettingsModal from "@/components/AudioSettingsModal";
import PQSecurityModal from "@/components/PQSecurityModal";
import type { CryptoMode, ChatMessage, StoredRoomSummary } from "@/types";
import type { QSIdentity } from "@/services/IdentityService";

function BurnCountdown({ msg, onDelete }: { msg: ChatMessage; onDelete: (id: string) => void }) {
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (!msg.expiresAt) return msg.burnDuration || 10;
    return Math.max(0, Math.ceil((msg.expiresAt - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!msg.expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((msg.expiresAt! - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        soundHapticService.play("burn");
        soundHapticService.triggerHaptic("burn");
        onDelete(msg.id);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [msg.expiresAt, msg.id, onDelete]);

  const total = msg.burnDuration || 10;
  const pct = Math.max(0, Math.min(100, (timeLeft / total) * 100));

  return (
    <div className="mb-2 p-1.5 rounded-lg bg-black/40 border border-amber-500/20 flex flex-col gap-1 select-none">
      <div className="flex items-center justify-between text-[10px] font-mono font-bold text-amber-300">
        <span className="flex items-center gap-1">
          <Flame className="w-3 h-3 text-amber-400 animate-pulse" />
          <span>Self-destructs in {timeLeft}s</span>
        </span>
        <span className="text-amber-400/80">{timeLeft}s</span>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1 overflow-hidden">
        <div
          className="bg-gradient-to-r from-amber-400 to-rose-500 h-full transition-all duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  identity?: QSIdentity | null;
  canInstall?: boolean;
  onPromptInstall?: () => void;
  onAliasChange?: (alias: string) => Promise<void> | void;
  onExportIdentity?: () => string | null;
  onDestroyIdentity?: () => Promise<void> | void;
  onBackToHome?: () => void;
  onSessionChange?: (s: { mode: string; sessionId?: string; handshakeComplete?: boolean; roomId?: string; participantCount?: number } | null) => void;
}

export default function ChatPage({
  identity,
  canInstall,
  onPromptInstall,
  onAliasChange,
  onExportIdentity,
  onDestroyIdentity,
  onBackToHome,
  onSessionChange
}: Props) {
  const [activeRoomId, setActiveRoomId] = useState<string>("");
  const [mode, setMode] = useState<CryptoMode>("hybrid");
  const [inputText, setInputText] = useState("");
  const [sendError, setSendError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "rooms" | "direct" | "vault">("all");
  const [recentRooms, setRecentRooms] = useState<StoredRoomSummary[]>([]);
  
  // Modals & Drawers
  const [newRoomModalOpen, setNewRoomModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"create" | "join">("create");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);
  const [wireModalMsg, setWireModalMsg] = useState<ChatMessage | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [audioModalOpen, setAudioModalOpen] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [burnTimer, setBurnTimer] = useState<number | null>(null);
  const [isRoomVerified, setIsRoomVerified] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(soundHapticService.isSoundEnabled());

  useEffect(() => {
    return soundHapticService.subscribe(() => {
      setSoundEnabled(soundHapticService.isSoundEnabled());
    });
  }, []);

  // Check verification state for active room
  useEffect(() => {
    if (typeof window !== "undefined" && activeRoomId) {
      const verified = localStorage.getItem(`qs_verified_${activeRoomId}`) === "true";
      setIsRoomVerified(verified);
    }
  }, [activeRoomId, isSecurityModalOpen]);

  // UX & Feedback
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedWire, setCopiedWire] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<"idle" | "loading" | "active" | "denied">("idle");
  const [isStandalone, setIsStandalone] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    roomState, session, messages, handshakeState, transferProgress, connect,
    initiateHandshake, retryHandshake, sendMessage, sendFile, deleteMessageFromChat, disconnect, clearHistory
  } = useSecureSession(identity);

  // --- Load Recent Rooms from IndexedDB --------------------------------------
  const loadRecentRooms = async () => {
    try {
      const rooms = await StorageService.getRecentRooms();
      setRecentRooms(rooms);
    } catch (e) {
      console.error("[QS] Failed to load encrypted recent rooms:", e);
    }
  };

  useEffect(() => {
    loadRecentRooms();
  }, [activeRoomId, messages.length]);

  // --- Push & PWA Lifecycle -------------------------------------------------
  useEffect(() => {
    setIsStandalone(pushService.isStandalone());
    const perm = pushService.getPermission();
    if (perm === "granted") {
      setPushStatus("active");
    } else if (perm === "denied") {
      setPushStatus("denied");
    }
  }, []);

  // --- Propagate Session State ----------------------------------------------
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

  // --- Auto-Scroll on Message ------------------------------------------------
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, transferProgress]);

  // --- Actions: Create Room --------------------------------------------------
  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    try {
      const { room_id } = await api.createRoom();
      setActiveRoomId(room_id);
      await connect(room_id, mode);
      setNewRoomModalOpen(false);
      setMobileChatOpen(true);
      await loadRecentRooms();
    } catch (e) {
      alert("Failed to create room: " + (e as Error).message);
    } finally {
      setIsCreatingRoom(false);
    }
  };

  // --- Actions: Join Room ----------------------------------------------------
  const handleJoinRoom = async (codeToJoin?: string) => {
    const code = (codeToJoin || joinCodeInput).trim().toUpperCase();
    if (!code) return;
    setIsJoiningRoom(true);
    try {
      setActiveRoomId(code);
      await connect(code, mode);
      setJoinCodeInput("");
      setNewRoomModalOpen(false);
      setMobileChatOpen(true);
      await loadRecentRooms();
    } catch (e) {
      alert("Failed to join room: " + (e as Error).message);
    } finally {
      setIsJoiningRoom(false);
    }
  };

  // --- Switch / Resume Room -------------------------------------------------
  const handleSelectRoom = async (roomId: string) => {
    if (activeRoomId === roomId) {
      setMobileChatOpen(true);
      return;
    }
    setActiveRoomId(roomId);
    await connect(roomId, mode);
    setMobileChatOpen(true);
  };

  // --- Send Message ----------------------------------------------------------
  const handleSend = async () => {
    if (!inputText.trim()) return;
    setSendError("");
    try {
      await sendMessage(inputText.trim(), burnTimer ?? undefined);
      setInputText("");
      await loadRecentRooms();
    } catch (e) {
      setSendError((e as Error).message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // --- File Transmission -----------------------------------------------------
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setSendError("");
      try {
        await sendFile(files[0]);
      } catch (err) {
        setSendError((err as Error).message);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
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

  // --- Disconnect / Back -----------------------------------------------------
  const handleLeaveRoom = () => {
    disconnect();
    setActiveRoomId("");
    setMobileChatOpen(false);
    loadRecentRooms();
  };

  // --- Push Toggle -----------------------------------------------------------
  const handleTogglePush = async () => {
    if (pushStatus === "denied") {
      alert("Push notifications are blocked in your browser settings. Please permit notifications for QuantumShield.");
      return;
    }
    setPushStatus("loading");
    if (pushStatus === "active") {
      await pushService.unsubscribeFromRoom(activeRoomId, roomState.participantId);
      setPushStatus("idle");
    } else {
      const success = await pushService.subscribeToRoom(activeRoomId, roomState.participantId);
      if (success) {
        setPushStatus("active");
      } else {
        setPushStatus(pushService.getPermission() === "denied" ? "denied" : "idle");
      }
    }
  };

  // --- Copy Code -------------------------------------------------------------
  const copyRoomCode = () => {
    if (!activeRoomId) return;
    navigator.clipboard.writeText(activeRoomId);
    setCopiedCode(true);
    soundHapticService.play("tap");
    soundHapticService.triggerHaptic("tap");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // --- Filtered Rooms List ---------------------------------------------------
  const filteredRooms = useMemo(() => {
    let list = recentRooms;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      list = list.filter(r => r.roomId.includes(q) || r.lastMessageSnippet.toUpperCase().includes(q));
    }
    if (filterTab === "rooms") {
      list = list.filter(r => r.messageCount > 1);
    } else if (filterTab === "vault") {
      list = list.filter(r => r.messageCount > 0);
    }
    return list;
  }, [recentRooms, searchQuery, filterTab]);

  // Deterministic Avatar Gradient Generator
  const getAvatarGradient = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "from-teal-500 to-emerald-700",
      "from-cyan-500 to-blue-700",
      "from-indigo-500 to-purple-700",
      "from-emerald-500 to-teal-800",
      "from-fuchsia-500 to-pink-700",
      "from-blue-500 to-cyan-800"
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="h-full w-full flex overflow-hidden bg-wa-dark select-none relative">
      {/* ===================================================================== */}
      {/* LEFT PANE: WhatsApp Conversation Roster & Directory                   */}
      {/* ===================================================================== */}
      <aside
        className={`${
          mobileChatOpen && activeRoomId ? "hidden md:flex" : "flex"
        } w-full md:w-[360px] lg:w-[400px] xl:w-[420px] shrink-0 border-r border-wa-subtle bg-wa-panel flex-col h-full z-20`}
      >
        {/* Top User Bar */}
        <div className="p-3.5 bg-wa-card border-b border-wa-subtle flex items-center justify-between">
          <div
            onClick={() => setIdentityModalOpen(true)}
            className="flex items-center gap-3 cursor-pointer group hover:opacity-90 transition-opacity"
            title="View Identity Key & QR Profile"
          >
            <div className={`w-10 h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(identity?.fingerprint || "user")} flex items-center justify-center text-white font-bold text-sm shadow-md ring-2 ring-emerald-500/30`}>
              {identity?.alias ? identity.alias.slice(0, 2).toUpperCase() : <Shield className="w-5 h-5 text-white" />}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white text-sm truncate flex items-center gap-1.5 group-hover:text-wa-teal transition-colors">
                <span>{identity?.alias || "Anonymous Agent"}</span>
              </p>
              <p className="text-[11px] font-mono text-wa-muted flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-wa-teal animate-pulse" />
                <span>{identity?.fingerprint || "Key Active"}</span>
              </p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-1 text-wa-muted">
            {canInstall && (
              <button
                onClick={onPromptInstall}
                title="Install QuantumShield as PWA App"
                className="p-2 rounded-full hover:bg-wa-hover text-wa-teal hover:text-white transition-colors"
              >
                <Smartphone className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setIdentityModalOpen(true)}
              title="Identity & QR Export"
              className="p-2 rounded-full hover:bg-wa-hover hover:text-white transition-colors"
            >
              <QrCode className="w-5 h-5" />
            </button>
            {onBackToHome && (
              <button
                onClick={() => {
                  soundHapticService.triggerHaptic("tap");
                  onBackToHome();
                }}
                title="Return to Product Landing Page"
                className="p-2 rounded-full hover:bg-wa-hover text-wa-muted hover:text-cyan-400 transition-colors active:scale-95"
              >
                <Globe className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => {
                soundHapticService.triggerHaptic("tap");
                setAudioModalOpen(true);
              }}
              title="Audio & Haptic Feedback Settings"
              className="p-2 rounded-full hover:bg-wa-hover text-wa-muted hover:text-white transition-colors active:scale-95"
            >
              {soundEnabled ? <Volume2 className="w-5 h-5 text-wa-teal" /> : <VolumeX className="w-5 h-5 text-wa-muted" />}
            </button>
            <button
              onClick={() => {
                soundHapticService.triggerHaptic("tap");
                setModalTab("create");
                setNewRoomModalOpen(true);
              }}
              title="New Secure Room"
              className="p-2 rounded-full bg-wa-teal/10 hover:bg-wa-teal/20 text-wa-teal transition-colors active:scale-95"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar & Instant Join */}
        <div className="p-2.5 border-b border-wa-subtle bg-wa-panel">
          <div className="relative flex items-center bg-wa-card border border-wa-subtle rounded-xl px-3 py-1.5 focus-within:border-wa-teal transition-colors">
            <Search className="w-4 h-4 text-wa-muted shrink-0 mr-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or enter room code…"
              className="w-full bg-transparent text-sm text-wa-body placeholder-wa-muted focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-wa-muted hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Instant Join Prompt if user typed room code (6-16 characters) */}
          {searchQuery.trim().length >= 6 && searchQuery.trim().length <= 16 && !recentRooms.some(r => r.roomId === searchQuery.trim().toUpperCase()) && (
            <div
              onClick={() => handleJoinRoom(searchQuery.trim())}
              className="mt-2 p-2.5 rounded-lg bg-wa-teal/10 border border-wa-teal/30 hover:bg-wa-teal/20 transition-all cursor-pointer flex items-center justify-between text-xs animate-fade-in"
            >
              <div className="flex items-center gap-2 text-wa-teal font-semibold">
                <LogIn className="w-4 h-4" />
                <span>Join Room "{searchQuery.trim().toUpperCase()}"</span>
              </div>
              <ArrowRight className="w-4 h-4 text-wa-teal" />
            </div>
          )}
        </div>

        {/* WhatsApp-Style Filter Pills */}
        <div className="px-3 py-2 flex items-center gap-1.5 border-b border-wa-subtle bg-wa-panel overflow-x-auto text-xs font-medium">
          {(["all", "rooms", "vault"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`px-3 py-1 rounded-full transition-colors capitalize ${
                filterTab === tab
                  ? "bg-wa-teal/20 text-wa-teal border border-wa-teal/40 font-semibold"
                  : "bg-wa-card text-wa-muted hover:text-white border border-wa-subtle"
              }`}
            >
              {tab === "all" ? "All Chats" : tab === "rooms" ? "Active Rooms" : "Encrypted Vault"}
            </button>
          ))}
        </div>

        {/* Conversations Scroll Area */}
        <div className="flex-1 overflow-y-auto divide-y divide-wa-subtle">
          {filteredRooms.length === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-3 text-wa-muted">
              <div className="w-12 h-12 rounded-full bg-wa-card border border-wa-subtle flex items-center justify-center text-wa-muted">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">No encrypted chats yet</p>
                <p className="text-xs text-wa-muted mt-1 max-w-[220px]">
                  Create a new secure room or enter an 8-character code to begin.
                </p>
              </div>
              <button
                onClick={() => {
                  setModalTab("create");
                  setNewRoomModalOpen(true);
                }}
                className="mt-2 px-4 py-2 rounded-xl bg-wa-teal hover:bg-[#00c298] text-white text-xs font-semibold shadow-md transition-colors"
              >
                Start New Room
              </button>
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isActive = activeRoomId === room.roomId;
              return (
                <div
                  key={room.roomId}
                  onClick={() => handleSelectRoom(room.roomId)}
                  className={`flex items-center justify-between p-3.5 hover:bg-wa-hover cursor-pointer transition-colors group relative ${
                    isActive ? "bg-wa-card border-l-4 border-wa-teal" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div className={`w-11 h-11 rounded-full bg-gradient-to-tr ${getAvatarGradient(room.roomId)} flex items-center justify-center text-white shrink-0 shadow`}>
                      <Shield className="w-5 h-5 text-white" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white truncate group-hover:text-wa-teal transition-colors">
                          {room.roomId}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-wa-panel border border-wa-subtle text-wa-muted font-mono">
                          PQ
                        </span>
                      </div>
                      <p className="text-xs text-wa-muted truncate flex items-center gap-1">
                        {room.lastMessageSnippet ? (
                          <span>{room.lastMessageSnippet}</span>
                        ) : (
                          <span className="italic">Secure room active</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0 text-[11px] text-wa-muted font-mono">
                    <span>
                      {new Date(room.lastActivity).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded-full bg-wa-card border border-wa-subtle text-[10px] text-wa-muted">
                        {room.messageCount} msg{room.messageCount === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Vault Footer Status */}
        <div className="p-3 bg-wa-card/60 border-t border-wa-subtle flex items-center justify-between text-[11px] text-wa-muted font-mono">
          <div className="flex items-center gap-1.5 text-wa-teal">
            <HardDrive className="w-3.5 h-3.5" />
            <span>Client AES-256 Vault Active</span>
          </div>
          <span className="text-[10px] text-slate-500">Zero Cloud Archive</span>
        </div>
      </aside>

      {/* ===================================================================== */}
      {/* RIGHT PANE: WhatsApp Active Chat Window or Welcome Splash             */}
      {/* ===================================================================== */}
      <main
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`${
          !mobileChatOpen && !activeRoomId ? "hidden md:flex" : "flex"
        } flex-1 flex-col h-full bg-wa-dark relative overflow-hidden`}
      >
        {/* Drag & Drop Visual Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-40 bg-wa-dark/95 border-2 border-dashed border-wa-teal flex flex-col items-center justify-center gap-3 backdrop-blur-sm animate-fade-in">
            <UploadCloud className="w-14 h-14 text-wa-teal animate-bounce" />
            <p className="text-white text-lg font-bold">Drop File to Encrypt & Transmit</p>
            <p className="text-wa-muted text-xs font-mono">End-to-End Post-Quantum AES-256-GCM Streaming</p>
          </div>
        )}

        {/* CONDITION 1: NO ACTIVE ROOM -> WHATSAPP WEB WELCOME SPLASH SCREEN */}
        {!activeRoomId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center qs-doodle-bg relative">
            <div className="max-w-md space-y-6 animate-fade-in">
              <div className="relative mx-auto w-24 h-24 rounded-full bg-wa-card border border-wa-subtle flex items-center justify-center shadow-2xl">
                <div className="absolute inset-0 rounded-full border border-wa-teal/30 animate-ping opacity-25" />
                <Shield className="w-12 h-12 text-wa-teal" />
              </div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">QuantumShield Web</h1>
                <p className="text-sm text-wa-muted leading-relaxed">
                  Post-quantum end-to-end encrypted messaging, group channels, and file streaming. No accounts or phone numbers required.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  onClick={() => {
                    setModalTab("create");
                    setNewRoomModalOpen(true);
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-wa-teal hover:bg-[#00c298] text-white font-semibold text-sm shadow-lg shadow-teal-950/40 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>New Secure Room</span>
                </button>
                <button
                  onClick={() => {
                    setModalTab("join");
                    setNewRoomModalOpen(true);
                  }}
                  className="w-full py-3 px-4 rounded-xl bg-wa-card hover:bg-wa-hover border border-wa-subtle text-white font-semibold text-sm transition-all flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Join with Code</span>
                </button>
              </div>

              <div className="pt-6 border-t border-wa-subtle text-xs text-wa-muted space-y-1 font-mono">
                <p className="flex items-center justify-center gap-1.5 text-wa-teal font-semibold">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Protected by ML-KEM-768 + Curve25519</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  Messages are encrypted client-side and never saved to any server disk.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* CONDITION 2: ACTIVE ROOM OPEN -> FULL WHATSAPP CHAT EXPERIENCE */
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Top WhatsApp Chat App Bar */}
            <div className="px-2.5 sm:px-4 py-2 sm:py-2.5 bg-wa-card border-b border-wa-subtle flex items-center justify-between shrink-0 z-10 gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
                {/* Mobile Back Button */}
                <button
                  onClick={() => setMobileChatOpen(false)}
                  className="md:hidden p-1.5 rounded-lg text-wa-muted hover:text-white hover:bg-wa-hover transition-colors shrink-0"
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>

                {/* Room Avatar & Quick Security Verification */}
                <button
                  onClick={() => setIsSecurityModalOpen(true)}
                  title="Click to view Post-Quantum Security Certificate"
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr ${getAvatarGradient(activeRoomId)} flex items-center justify-center text-white shrink-0 shadow hover:ring-2 hover:ring-wa-teal transition-all`}
                >
                  {isRoomVerified ? <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-300" /> : <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-white" />}
                </button>

                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center gap-1.5 sm:gap-2">
                    <span className="font-bold text-white text-sm sm:text-base font-mono tracking-wider truncate">
                      {activeRoomId}
                    </span>
                    <button
                      onClick={copyRoomCode}
                      title="Copy Room Code to share with peers"
                      className="text-xs text-wa-muted hover:text-wa-teal flex items-center gap-1 transition-colors shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      {copiedCode && <span className="text-[10px] text-wa-teal font-bold animate-pulse hidden sm:inline">Copied!</span>}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-wa-muted mt-0.5 font-mono overflow-hidden whitespace-nowrap">
                    <span className="flex items-center gap-1 text-wa-teal shrink-0">
                      <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span>{roomState.participantCount}/8</span>
                    </span>
                    <span className="text-white/30 shrink-0">•</span>
                    <span className="text-fuchsia-300 font-semibold shrink-0">
                      {roomState.isHub ? "⭐️ Star Hub" : "Spoke"}
                    </span>
                    <span className="text-white/30 shrink-0">•</span>
                    <div className="truncate flex items-center gap-1">
                      {roomState.participantCount < 2 ? (
                        <span className="text-wa-muted">Waiting for peer…</span>
                      ) : handshakeState === "complete" ? (
                        <button
                          onClick={() => setIsSecurityModalOpen(true)}
                          className="text-emerald-400 font-semibold hover:underline flex items-center gap-1"
                          title="Click to view Post-Quantum Security Certificate"
                        >
                          <span>PQ Active ✓</span>
                          {isRoomVerified && <span className="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 rounded border border-emerald-500/30">Verified</span>}
                        </button>
                      ) : handshakeState === "generating_keys" ? (
                        <span className="text-amber-400 animate-pulse">Generating ML-KEM keys…</span>
                      ) : handshakeState === "exchanging" ? (
                        <span className="text-amber-400 animate-pulse">Exchanging PQ public keys…</span>
                      ) : handshakeState === "deriving" ? (
                        <span className="text-amber-400 animate-pulse">Deriving AES-256 session key…</span>
                      ) : handshakeState === "failed" ? (
                        <button
                          onClick={retryHandshake}
                          className="text-rose-400 hover:text-rose-300 font-semibold underline flex items-center gap-1 cursor-pointer"
                          title="Click to retry handshake"
                        >
                          <span>Failed • Tap to Retry</span>
                          <RotateCw className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-amber-400">Negotiating…</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Action Icons */}
              <div className="flex items-center gap-0.5 sm:gap-1 text-wa-muted shrink-0">
                {/* Verify Quantum Security & SAS Fingerprint */}
                <button
                  onClick={() => setIsSecurityModalOpen(true)}
                  title="Verify Post-Quantum Security (SAS Safety Number)"
                  className={`p-1.5 sm:p-2 rounded-full transition-colors ${
                    isRoomVerified ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20" : "hover:bg-wa-hover hover:text-white"
                  }`}
                >
                  <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Zero-Knowledge Push Notification Toggle */}
                <button
                  onClick={handleTogglePush}
                  disabled={pushStatus === "loading"}
                  title={
                    pushStatus === "active"
                      ? "Zero-Knowledge Push Active (Click to disable)"
                      : "Enable Zero-Knowledge Push Notifications"
                  }
                  className={`p-1.5 sm:p-2 rounded-full transition-colors ${
                    pushStatus === "active"
                      ? "text-wa-teal bg-wa-teal/10 hover:bg-wa-teal/20"
                      : "hover:bg-wa-hover hover:text-white"
                  }`}
                >
                  {pushStatus === "loading" ? (
                    <Loader className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-wa-teal" />
                  ) : pushStatus === "active" ? (
                    <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <BellOff className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>

                {/* Participant Roster Button */}
                <button
                  onClick={() => setShowRosterModal(!showRosterModal)}
                  title="View Connected Participants"
                  className={`p-1.5 sm:p-2 rounded-full transition-colors ${
                    showRosterModal ? "text-wa-teal bg-wa-teal/10" : "hover:bg-wa-hover hover:text-white"
                  }`}
                >
                  <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Erase History Button */}
                <button
                  onClick={() => setConfirmClearOpen(true)}
                  title="Cryptographically Erase Room History"
                  className="p-1.5 sm:p-2 rounded-full hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Leave Room */}
                <button
                  onClick={handleLeaveRoom}
                  title="Disconnect & Leave Room"
                  className="p-1.5 sm:p-2 rounded-full hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>
            </div>

            {/* Live Participant Roster Dropdown Panel */}
            {showRosterModal && (
              <div className="bg-wa-card border-b border-wa-subtle p-3 animate-fade-in text-xs font-mono">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-white uppercase text-[11px] tracking-wider flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-wa-teal" />
                    <span>Connected Participants ({roomState.participantCount}/8)</span>
                  </span>
                  <button onClick={() => setShowRosterModal(false)} className="text-wa-muted hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {roomState.participants.map((p) => {
                    const isSelf = p.id === roomState.participantId;
                    const isHub = p.role === "hub" || p.id === roomState.hubId;
                    return (
                      <div
                        key={p.id}
                        className={`px-2.5 py-1 rounded-lg border flex items-center gap-2 ${
                          isSelf
                            ? "bg-wa-teal/10 border-wa-teal/40 text-wa-teal"
                            : isHub
                            ? "bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300"
                            : "bg-wa-panel border-wa-subtle text-wa-body"
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full ${isHub ? "bg-fuchsia-400" : "bg-wa-teal"}`} />
                        <span className="font-semibold">{p.alias || (isSelf ? "You" : `Peer ${p.id.slice(0, 4)}`)}</span>
                        {p.fingerprint && <span className="text-[10px] text-wa-muted">({p.fingerprint})</span>}
                        <span className="text-[9px] px-1 py-0.2 rounded font-bold uppercase bg-black/40">
                          {isHub ? "HUB" : "PEER"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chat Messages Scroll Canvas with WhatsApp Vector Wallpaper */}
            <div className="flex-1 overflow-y-auto px-4 md:px-12 py-4 space-y-3 qs-doodle-bg">
              {/* Centered WhatsApp Date Separator */}
              <div className="flex justify-center my-2">
                <span className="px-3 py-1 rounded-lg bg-wa-card border border-wa-subtle text-[11px] font-mono text-wa-muted uppercase tracking-wider shadow">
                  Today · Encrypted Channel
                </span>
              </div>

              {/* Waiting for Peer Screen */}
              {roomState.participantCount < 2 && handshakeState === "idle" && (
                <div className="flex flex-col items-center justify-center p-8 text-center gap-3 my-6">
                  <div className="p-4 rounded-full bg-wa-card border border-wa-subtle">
                    <RefreshCw className="w-8 h-8 text-wa-teal animate-spin-slow" />
                  </div>
                  <div>
                    <p className="text-white font-bold text-base">Waiting for peer to join…</p>
                    <p className="text-xs text-wa-muted mt-1">Share this room code with other participants:</p>
                    <div className="mt-3 inline-flex items-center gap-3 px-4 py-2 bg-wa-card border border-wa-teal/40 rounded-xl shadow-lg">
                      <span className="text-wa-teal font-mono text-xl font-bold tracking-widest">{activeRoomId}</span>
                      <button
                        onClick={copyRoomCode}
                        className="px-3 py-1 rounded-lg bg-wa-teal/20 text-wa-teal hover:bg-wa-teal/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Render Messages */}
              {messages.map((msg) => {
                const isSelf = msg.senderRole === "self";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isSelf ? "justify-end" : "justify-start"} group animate-fade-in`}
                  >
                    <div
                      className={`max-w-[85%] md:max-w-md lg:max-w-lg rounded-2xl px-3.5 py-2.5 shadow-md relative transition-all ${
                        isSelf
                          ? "bg-wa-outgoing text-wa-body rounded-tr-none border border-emerald-500/20"
                          : "bg-wa-incoming text-wa-body rounded-tl-none border border-wa-subtle"
                      }`}
                    >
                      {/* Sender Alias in Group Chats */}
                      {!isSelf && (
                        <div className="flex items-center gap-1.5 mb-1 text-xs font-bold text-wa-teal pb-1 border-b border-white/5">
                          <span>{msg.senderAlias || `Peer ${msg.senderId.slice(0, 4)}`}</span>
                          {msg.senderFingerprint && (
                            <span className="text-[10px] text-wa-muted font-normal font-mono">
                              ({msg.senderFingerprint})
                            </span>
                          )}
                        </div>
                      )}

                      {/* File / Image Attachment */}
                      {msg.attachment && (
                        <div className="mb-2">
                          {msg.attachment.isImage ? (
                            <div className="relative overflow-hidden rounded-xl border border-black/20 bg-black/40">
                              <img
                                src={msg.attachment.blobUrl || msg.attachment.dataUrl}
                                alt={msg.attachment.fileName}
                                className="max-h-72 w-auto rounded-xl object-contain cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={() => {
                                  if (msg.attachment?.blobUrl) {
                                    window.open(msg.attachment.blobUrl, "_blank");
                                  }
                                }}
                              />
                              <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-mono text-slate-300 bg-black/60">
                                <span className="truncate max-w-[200px]">{msg.attachment.fileName}</span>
                                <span>{(msg.attachment.fileSize / 1024).toFixed(1)} KB</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-3 rounded-xl border border-black/20 bg-black/30 gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <FileText className="w-6 h-6 text-wa-teal shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white truncate max-w-[200px]">
                                    {msg.attachment.fileName}
                                  </p>
                                  <p className="text-[10px] text-wa-muted font-mono">
                                    {(msg.attachment.fileSize / 1024).toFixed(1)} KB
                                  </p>
                                </div>
                              </div>
                              {msg.attachment.blobUrl && (
                                <a
                                  href={msg.attachment.blobUrl}
                                  download={msg.attachment.fileName}
                                  className="p-2 rounded-lg bg-wa-teal/20 hover:bg-wa-teal/30 text-wa-teal transition-colors"
                                  title="Download file"
                                >
                                  <Download className="w-4 h-4" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message Self-Destruct Fuse */}
                      {msg.burnDuration && (
                        <BurnCountdown msg={msg} onDelete={deleteMessageFromChat} />
                      )}

                      {/* Message Text Content */}
                      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap select-text">
                        {msg.authVerified ? msg.plaintext : "⚠️ Authentication failed — message rejected"}
                      </p>

                      {/* Micro Timestamp & WhatsApp Delivery Status */}
                      <div className="flex items-center justify-end gap-1.5 mt-1 text-[10px] font-mono text-slate-300/80">
                        <span>{new Date(msg.displayedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        
                        {/* Status Checkmarks */}
                        {isSelf ? (
                          <span title={msg.status === "delivered" ? "Delivered to peer (acknowledged)" : "Sent to relay"}>
                            {msg.status === "delivered" ? (
                              <span className="text-wa-cyan flex items-center font-bold tracking-tighter">
                                <Check className="w-3.5 h-3.5" />
                                <Check className="w-3.5 h-3.5 -ml-2" />
                              </span>
                            ) : (
                              <Check className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </span>
                        ) : (
                          <span title="Decrypted locally via AES-256-GCM">
                            <Lock className="w-2.5 h-2.5 text-wa-teal" />
                          </span>
                        )}

                        {/* Wire Inspect Icon on hover */}
                        <button
                          onClick={() => setWireModalMsg(msg)}
                          title="Inspect raw cryptographic wire frame"
                          className="opacity-0 group-hover:opacity-100 ml-1 text-wa-muted hover:text-white transition-opacity"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* File Transfer Streaming Progress Bar */}
            {transferProgress && (
              <div className="px-4 py-2 bg-wa-card border-t border-wa-subtle flex items-center justify-between text-xs font-mono animate-fade-in">
                <div className="flex items-center gap-2 text-wa-teal">
                  <UploadCloud className="w-4 h-4 animate-bounce" />
                  <span className="font-semibold truncate max-w-[220px]">
                    {transferProgress.direction === "sending" ? "Sending:" : "Receiving:"} {transferProgress.fileName}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-32 bg-wa-dark rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-wa-teal h-full transition-all duration-150"
                      style={{ width: `${transferProgress.percentage}%` }}
                    />
                  </div>
                  <span className="text-wa-muted">{transferProgress.percentage}%</span>
                </div>
              </div>
            )}

            {/* Hidden Native File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              className="hidden"
            />

            {/* Bottom WhatsApp-Style Input Bar */}
            <div className="p-2.5 sm:p-3 bg-wa-card border-t border-wa-subtle flex items-center gap-2 sm:gap-2.5 shrink-0 z-10">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={handshakeState !== "complete"}
                title="Attach Document or Image"
                className="p-2 sm:p-2.5 rounded-full hover:bg-wa-hover text-wa-muted hover:text-white transition-colors disabled:opacity-40"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              {/* Disappearing / Self-Destruct Message Toggle */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    const options = [null, 10, 30, 60];
                    const currIdx = options.indexOf(burnTimer);
                    const next = options[(currIdx + 1) % options.length];
                    setBurnTimer(next);
                    soundHapticService.play("tap");
                    soundHapticService.triggerHaptic("tap");
                  }}
                  title={burnTimer ? `Disappearing Messages Active (${burnTimer}s)` : "Enable Disappearing Messages"}
                  className={`p-2 sm:p-2.5 rounded-full transition-all relative ${
                    burnTimer
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 shadow-sm"
                      : "hover:bg-wa-hover text-wa-muted hover:text-white"
                  }`}
                >
                  <Flame className="w-5 h-5" />
                  {burnTimer && (
                    <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[9px] font-black px-1 rounded-full shadow leading-tight">
                      {burnTimer}s
                    </span>
                  )}
                </button>
              </div>

              <div className={`flex-1 relative flex items-center bg-wa-incoming border rounded-full px-4 py-2 transition-colors ${
                burnTimer ? "border-amber-500/40 focus-within:border-amber-400" : "border-wa-subtle focus-within:border-wa-teal"
              }`}>
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={handshakeState !== "complete"}
                  placeholder={
                    handshakeState === "complete"
                      ? burnTimer
                        ? `🔥 Disappearing in ${burnTimer}s • Type a message…`
                        : "Type an encrypted message…"
                      : "Establishing post-quantum channel…"
                  }
                  className="w-full bg-transparent text-sm text-wa-body placeholder-wa-muted focus:outline-none disabled:opacity-40"
                />
              </div>

              <button
                onClick={handleSend}
                disabled={!inputText.trim() || handshakeState !== "complete"}
                className={`p-2.5 rounded-full text-white shadow-lg transition-transform active:scale-95 disabled:opacity-40 ${
                  burnTimer
                    ? "bg-gradient-to-r from-amber-500 to-rose-500 shadow-amber-950/40 hover:brightness-110"
                    : "bg-wa-teal hover:bg-[#00c298] shadow-teal-950/40"
                }`}
                title={burnTimer ? `Send Disappearing Message (${burnTimer}s)` : "Send Encrypted Message"}
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODAL: CREATE / JOIN ROOM                                             */}
      {/* ===================================================================== */}
      {newRoomModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-wa-card border border-wa-subtle rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-wa-subtle pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-wa-teal" />
                <h3 className="font-bold text-white text-base">New Secure Conversation</h3>
              </div>
              <button onClick={() => setNewRoomModalOpen(false)} className="text-wa-muted hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs: Create vs Join */}
            <div className="grid grid-cols-2 gap-2 bg-wa-panel p-1 rounded-xl border border-wa-subtle">
              <button
                onClick={() => setModalTab("create")}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                  modalTab === "create" ? "bg-wa-card text-white shadow" : "text-wa-muted hover:text-white"
                }`}
              >
                Create Room
              </button>
              <button
                onClick={() => setModalTab("join")}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors ${
                  modalTab === "join" ? "bg-wa-card text-white shadow" : "text-wa-muted hover:text-white"
                }`}
              >
                Join by Code
              </button>
            </div>

            {modalTab === "create" ? (
              <div className="space-y-4">
                <p className="text-xs text-wa-muted leading-relaxed">
                  Generates an ephemeral room on the relay server. Select your cryptographic cipher suite:
                </p>

                {/* Crypto Mode Selector */}
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setMode("hybrid")}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      mode === "hybrid"
                        ? "bg-wa-teal/15 border-wa-teal text-white shadow"
                        : "bg-wa-panel border-wa-subtle text-wa-muted hover:border-wa-teal/50"
                    }`}
                  >
                    <p className="font-bold text-xs flex items-center justify-between">
                      <span>Hybrid PQ</span>
                      {mode === "hybrid" && <Check className="w-3.5 h-3.5 text-wa-teal" />}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">X25519 + ML-KEM-768</p>
                    <span className="inline-block mt-2 text-[9px] px-1.5 py-0.2 rounded bg-wa-teal/20 text-wa-teal font-bold uppercase">
                      Quantum Proof
                    </span>
                  </div>

                  <div
                    onClick={() => setMode("classical")}
                    className={`p-3 rounded-xl border cursor-pointer transition-all ${
                      mode === "classical"
                        ? "bg-wa-teal/15 border-wa-teal text-white shadow"
                        : "bg-wa-panel border-wa-subtle text-wa-muted hover:border-wa-teal/50"
                    }`}
                  >
                    <p className="font-bold text-xs flex items-center justify-between">
                      <span>Classical</span>
                      {mode === "classical" && <Check className="w-3.5 h-3.5 text-wa-teal" />}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">X25519 Curve</p>
                    <span className="inline-block mt-2 text-[9px] px-1.5 py-0.2 rounded bg-white/5 text-slate-400 font-bold uppercase">
                      Standard E2E
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleCreateRoom}
                  disabled={isCreatingRoom}
                  className="w-full py-3 rounded-xl bg-wa-teal hover:bg-[#00c298] text-white font-semibold text-sm shadow-lg shadow-teal-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isCreatingRoom ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{isCreatingRoom ? "Creating Room…" : "Generate Room & Enter"}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-wa-muted leading-relaxed">
                  Enter the 8-character cryptographic code provided by your peer or hub:
                </p>
                <input
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  placeholder="Enter 8-digit code (e.g. A1B2C3D4)"
                  maxLength={8}
                  className="w-full px-4 py-2.5 rounded-xl bg-wa-panel border border-wa-subtle text-white font-mono text-center text-lg tracking-widest uppercase focus:outline-none focus:border-wa-teal"
                />
                <button
                  onClick={() => handleJoinRoom()}
                  disabled={isJoiningRoom || joinCodeInput.trim().length !== 8}
                  className="w-full py-3 rounded-xl bg-wa-teal hover:bg-[#00c298] text-white font-semibold text-sm shadow-lg shadow-teal-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  {isJoiningRoom ? <Loader className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  <span>{isJoiningRoom ? "Connecting…" : "Join Secure Room"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: IDENTITY PROFILE & QR EXPORT                                   */}
      {/* ===================================================================== */}
      {identityModalOpen && identity && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-wa-card border border-wa-subtle rounded-2xl max-w-sm w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setIdentityModalOpen(false)}
              className="absolute top-4 right-4 text-wa-muted hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <IdentityCard
              identity={identity}
              onAliasChange={onAliasChange || (async () => {})}
              onExport={onExportIdentity || (() => null)}
              onDelete={onDestroyIdentity || (async () => {})}
            />
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: WIRE FRAME INSPECTION                                          */}
      {/* ===================================================================== */}
      {wireModalMsg && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in font-mono text-xs">
          <div className="bg-wa-card border border-wa-subtle rounded-2xl max-w-xl w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-wa-subtle pb-3">
              <div className="flex items-center gap-2 text-wa-teal font-bold text-sm font-sans">
                <Shield className="w-4 h-4" />
                <span>Captured Wire Frame (Zero-Knowledge Ciphertext)</span>
              </div>
              <button onClick={() => setWireModalMsg(null)} className="text-wa-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-wa-muted text-xs font-sans">
              Raw JSON packet received by the relay server. Plaintext is mathematically impossible to read without client-side private keys:
            </p>

            <div className="bg-wa-dark p-3.5 rounded-xl border border-wa-subtle overflow-x-auto text-[11px] text-slate-300">
              <pre className="whitespace-pre-wrap break-all">
{JSON.stringify({
  type: "encrypted_message",
  sessionId: wireModalMsg.sessionId,
  messageId: wireModalMsg.id,
  senderId: wireModalMsg.senderId,
  sequenceNumber: wireModalMsg.meta.sequenceNumber,
  algorithm: wireModalMsg.meta.algorithm,
  nonce: wireModalMsg.encryptedPayload?.nonce,
  ciphertext: wireModalMsg.encryptedPayload?.ciphertext,
  timestamp: wireModalMsg.meta.timestamp,
}, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-wa-subtle">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(wireModalMsg.encryptedPayload, null, 2));
                  setCopiedWire(true);
                  setTimeout(() => setCopiedWire(false), 2000);
                }}
                className="px-3 py-1.5 rounded-lg border border-wa-subtle text-wa-muted hover:text-white text-xs flex items-center gap-1.5"
              >
                {copiedWire ? <Check className="w-3 h-3 text-wa-teal" /> : <Copy className="w-3 h-3" />}
                <span>{copiedWire ? "Copied" : "Copy Payload"}</span>
              </button>
              <button
                onClick={() => setWireModalMsg(null)}
                className="px-4 py-1.5 rounded-lg bg-wa-teal text-white text-xs font-semibold hover:bg-[#00c298]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CRYPTOGRAPHIC ERASE HISTORY CONFIRMATION                       */}
      {/* ===================================================================== */}
      {confirmClearOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-wa-card border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Erase Room History?</h3>
                <p className="text-xs text-wa-muted font-mono">Room: {activeRoomId}</p>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This will cryptographically erase all decrypted messages stored in your local IndexedDB vault. Because no server archives exist, this operation is permanent and irreversible.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                className="px-4 py-2 rounded-lg border border-wa-subtle text-wa-muted hover:text-white text-xs"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  await clearHistory();
                  setConfirmClearOpen(false);
                  loadRecentRooms();
                }}
                className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold transition-colors"
              >
                Erase History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio & Haptic Feedback Settings Modal */}
      <AudioSettingsModal
        isOpen={audioModalOpen}
        onClose={() => setAudioModalOpen(false)}
      />

      {/* Post-Quantum Security & SAS Key Verification Modal */}
      <PQSecurityModal
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
        roomId={activeRoomId}
        sessionKeyFingerprint={session?.sessionKeyFingerprint}
        cryptoMode={session?.mode || mode}
        isHub={roomState.isHub}
      />
    </div>
  );
}

import React, { useState } from "react";
import {
  Shield,
  Lock,
  Zap,
  Cpu,
  Users,
  HardDrive,
  FileText,
  Check,
  CheckCheck,
  ChevronDown,
  ArrowRight,
  ExternalLink,
  Menu,
  X,
  Sparkles,
  Eye,
  EyeOff,
  Radio,
  Send,
  Download,
  Key,
  Layers,
  HelpCircle,
  Server,
  Globe,
} from "lucide-react";
import { api } from "@/services/api";
import { soundHapticService } from "@/services/SoundHapticService";

interface LandingPageProps {
  onLaunchApp: () => void;
  onCreateRoom?: () => Promise<void>;
}

export default function LandingPage({ onLaunchApp, onCreateRoom }: LandingPageProps) {
  // Mobile Navigation Sheet State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Announcement Bar Visibility
  const [announcementVisible, setAnnouncementVisible] = useState(true);

  // Interactive Product Mockup State
  const [showCiphertext, setShowCiphertext] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [mockMessages, setMockMessages] = useState<
    Array<{
      id: string;
      sender: "Alice" | "Bob";
      text: string;
      ciphertext: string;
      time: string;
      status: "sent" | "delivered" | "read";
    }>
  >([
    {
      id: "1",
      sender: "Bob",
      text: "Has the Kyber-1024 lattice handshake completed?",
      ciphertext: "7f4a9b2c8e1d0f5b8a3e7c9d0b2f4a6c8e0d1f3b5a7c9e1d3f5a7b9c",
      time: "10:42 AM",
      status: "read",
    },
    {
      id: "2",
      sender: "Alice",
      text: "Yes. Ephemeral session derived via HKDF-SHA256. Zero plaintext on server.",
      ciphertext: "3a9c7e1d5f8b0a2c4e6d8f0b2a4c6e8d0f2a4b6c8e0d2f4a6b8c0d2e",
      time: "10:43 AM",
      status: "read",
    },
  ]);

  // Cryptographic Pipeline Active Step
  const [activePipelineStep, setActivePipelineStep] = useState(1);

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Quick Instant Room Trigger
  const [creatingInstantRoom, setCreatingInstantRoom] = useState(false);

  const handleInstantRoom = async () => {
    try {
      setCreatingInstantRoom(true);
      if (onCreateRoom) {
        await onCreateRoom();
      } else {
        const res = await api.createRoom();
        window.location.hash = `room=${res.room_id}`;
        onLaunchApp();
      }
    } catch (err) {
      console.error("Failed to create instant room:", err);
      onLaunchApp();
    } finally {
      setCreatingInstantRoom(false);
    }
  };

  const handleSendMock = (textToSend?: string) => {
    const text = textToSend || customInput;
    if (!text.trim() || isSimulating) return;

    soundHapticService.play("send");
    soundHapticService.triggerHaptic("send");

    setIsSimulating(true);
    const newId = Date.now().toString();
    const fakeCiphertext = Array.from({ length: 48 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");

    const newMsg = {
      id: newId,
      sender: "Alice" as const,
      text: text.trim(),
      ciphertext: fakeCiphertext,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      status: "sent" as const,
    };

    setMockMessages((prev) => [...prev, newMsg]);
    if (!textToSend) setCustomInput("");

    setTimeout(() => {
      soundHapticService.play("delivered");
      setMockMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, status: "delivered" } : m))
      );
    }, 400);

    setTimeout(() => {
      soundHapticService.play("receive");
      soundHapticService.triggerHaptic("receive");
      setMockMessages((prev) =>
        prev.map((m) => (m.id === newId ? { ...m, status: "read" } : m))
      );
      setIsSimulating(false);
    }, 900);
  };

  const pipelineSteps = [
    {
      num: 1,
      title: "Client KeyGen (Ed25519 & Kyber-1024)",
      subtitle: "100% In-Browser Execution",
      desc: "Client generates a long-term Ed25519 identity keypair and ephemeral Kyber-1024 post-quantum public keys using WebCrypto and WebAssembly in browser memory. Private keys never touch any disk or network wire.",
      code: "const { publicKey, privateKey } = await kyber.keyPair();\n// Derived inside isolated browser sandbox",
    },
    {
      num: 2,
      title: "Lattice Hybrid Encapsulation",
      subtitle: "ML-KEM-1024 + X25519",
      desc: "When connecting to a room, Alice encapsulates a 256-bit shared secret using Bob's Kyber-1024 lattice public key. This provides quantum resistance against Shor's algorithm and future quantum computers.",
      code: "const [ciphertext, sharedSecret] = await kyber.encapsulate(bobPubKey);\n// Dual-layer post-quantum protection",
    },
    {
      num: 3,
      title: "Ephemeral Session Derivation",
      subtitle: "HKDF-SHA256 Multi-Ratchet",
      desc: "Both participants derive a symmetric AES-256-GCM encryption key using HKDF-SHA256. Each message uses a unique 96-bit initialization vector (IV) to prevent replay attacks.",
      code: "const sessionKey = await hkdf(sharedSecret, salt, 'QuantumShield-v1');\n// Forward secrecy for every message packet",
    },
    {
      num: 4,
      title: "Zero-Knowledge Ephemeral Relay",
      subtitle: "Stateless FastAPI WebSocket Relay",
      desc: "The server receives only encrypted binary frames. It has no access to room keys, plaintext, or participant identities. No messages or logs are stored in databases.",
      code: "await websocket.send_bytes(encrypted_envelope);\n// Server inspects zero plaintext bytes",
    },
    {
      num: 5,
      title: "Decryption & In-Browser Vault",
      subtitle: "AES-256-GCM & Local IndexedDB",
      desc: "Bob's browser decrypts the packet using the session key. If local history is enabled, messages are saved into an IndexedDB vault encrypted with the user's sovereign identity key.",
      code: "const plaintext = await crypto.subtle.decrypt(aesParams, key, data);\n// Stored inside AES-GCM encrypted local vault",
    },
  ];

  const faqs = [
    {
      q: "Why do I need post-quantum encryption if quantum computers aren't here yet?",
      a: "State-sponsored intelligence agencies and adversaries are actively executing 'Harvest Now, Decrypt Later' (HNDL) attacks. They capture and store encrypted internet traffic today so they can decrypt it once fault-tolerant quantum computers become operational. QuantumShield protects your sensitive data against future retrospective decryption right now using NIST FIPS 203 ML-KEM.",
    },
    {
      q: "Does QuantumShield require my phone number or email address?",
      a: "No. QuantumShield requires zero personal identifiers. When you first open the app, your browser generates a sovereign cryptographic identity (Ed25519 keypair) directly in your browser. There are no telephone numbers, SMS OTPs, email verifications, or server-side user tables.",
    },
    {
      q: "Can the QuantumShield server read my messages or group conversations?",
      a: "No. The server operates in an ephemeral zero-knowledge relay mode. All encryption and decryption occurs strictly on client devices using the Web Crypto API. The server only relays opaque ciphertext frames and holds no cryptographic keys.",
    },
    {
      q: "How do Star Topology group chats work without a central server seeing plaintext?",
      a: "In rooms with up to 8 members, the room creator acts as an in-browser cryptographic Hub. When a participant sends a message, the Hub receives it encrypted under the Hub-Spoke key, decrypts it strictly in the Hub's browser memory, and re-encrypts it individually for each recipient. The server merely acts as a dumb pipe passing encrypted bytes.",
    },
    {
      q: "What happens if I refresh the page or restart my device?",
      a: "Your identity and chat history are saved in an encrypted IndexedDB vault on your device, unlocked by your local identity key. You will never lose your history on refresh. You can also export your identity as a JSON backup or QR code to migrate across devices.",
    },
    {
      q: "Can I self-host QuantumShield on my own server?",
      a: "Yes. QuantumShield includes a ready-to-run Docker Compose configuration with an Alpine Nginx reverse proxy and Python FastAPI backend. You can deploy it to any VPS, AWS EC2, or cloud provider in 30 seconds with zero external database configuration.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#050910] text-wa-body font-sans selection:bg-cyan-500/30 selection:text-white relative overflow-x-hidden">
      {/* Background Ambient Gradient Meshes */}
      <div className="fixed inset-0 pointer-events-none z-0 bg-gradient-mesh opacity-90" />
      <div className="fixed -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[550px] bg-gradient-to-b from-cyan-500/10 via-emerald-500/5 to-transparent blur-[140px] pointer-events-none z-0" />

      {/* Top Announcement Bar */}
      {announcementVisible && (
        <div className="relative z-30 bg-[#0d1526]/90 border-b border-cyan-500/20 backdrop-blur-md px-4 py-2 text-xs text-center flex items-center justify-center gap-3">
          <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            <span className="font-semibold tracking-wide">NIST FIPS 203 ML-KEM Standard:</span>
          </span>
          <span className="text-wa-muted hidden sm:inline">
            Hybrid lattice post-quantum encryption is operational across all QuantumShield rooms.
          </span>
          <a
            href="#architecture"
            className="text-white hover:text-cyan-300 font-semibold underline underline-offset-2 ml-1"
          >
            Learn more &rarr;
          </a>
          <button
            onClick={() => setAnnouncementVisible(false)}
            className="absolute right-4 text-wa-muted hover:text-white transition-colors"
            aria-label="Dismiss announcement"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sticky Navigation Bar */}
      <nav className="sticky top-0 z-30 w-full glass-panel border-b border-white/5 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="relative w-9 h-9 rounded-xl bg-[#0d1526] border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-500/20 group">
              <Shield className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
              <Lock className="w-2.5 h-2.5 text-emerald-400 absolute" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
                <span>QUANTUM</span>
                <span className="text-cyan-400 font-extrabold">SHIELD</span>
              </span>
              <span className="text-[9px] font-mono tracking-widest uppercase text-wa-teal -mt-1">
                PQ-MESSENGER • v1.0
              </span>
            </div>
          </div>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-wa-muted">
            <a href="#features" className="hover:text-cyan-400 transition-colors">Features</a>
            <a href="#architecture" className="hover:text-cyan-400 transition-colors">Architecture</a>
            <a href="#comparison" className="hover:text-cyan-400 transition-colors">Comparison</a>
            <a href="#pipeline" className="hover:text-cyan-400 transition-colors">Crypto Spec</a>
            <a href="#faq" className="hover:text-cyan-400 transition-colors">FAQ</a>
          </div>

          {/* Desktop Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <a
              href="https://github.com/BaggaByte/QuantumShield"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-lg border border-white/10 hover:border-white/20 text-xs font-mono text-wa-body hover:text-white transition-all flex items-center gap-1.5 bg-white/[0.03]"
            >
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3 text-wa-muted" />
            </a>

            <button
              onClick={onLaunchApp}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#005c4b] to-[#00a884] hover:from-[#00a884] hover:to-[#005c4b] text-white text-sm font-semibold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all flex items-center gap-2 group"
            >
              <span>Launch Web App</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Mobile Hamburger Toggle */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={onLaunchApp}
              className="px-3 py-1.5 rounded-lg bg-[#00a884] text-white text-xs font-semibold"
            >
              Launch
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-wa-muted hover:text-white rounded-lg focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Dropdown Sheet */}
        {mobileMenuOpen && (
          <div className="md:hidden glass-panel border-b border-white/10 px-4 pt-2 pb-6 space-y-3 animate-fade-in">
            <a
              href="#features"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm text-wa-body hover:text-cyan-400"
            >
              Features
            </a>
            <a
              href="#architecture"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm text-wa-body hover:text-cyan-400"
            >
              Architecture
            </a>
            <a
              href="#comparison"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm text-wa-body hover:text-cyan-400"
            >
              Comparison
            </a>
            <a
              href="#pipeline"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm text-wa-body hover:text-cyan-400"
            >
              Cryptographic Spec
            </a>
            <a
              href="#faq"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-sm text-wa-body hover:text-cyan-400"
            >
              FAQ
            </a>
            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLaunchApp();
                }}
                className="w-full py-2.5 rounded-xl bg-[#00a884] text-white text-sm font-semibold flex items-center justify-center gap-2"
              >
                <span>Launch Web App</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="https://github.com/BaggaByte/QuantumShield"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 text-center rounded-xl border border-white/10 text-xs font-mono text-wa-muted"
              >
                View on GitHub
              </a>
            </div>
          </div>
        )}
      </nav>

      {/* HERO SECTION (Split Hero Layout) */}
      <section className="relative z-10 pt-12 pb-20 md:pt-20 md:pb-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Column: Headlines & Action CTAs */}
          <div className="lg:col-span-7 flex flex-col items-start text-left space-y-6">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono tracking-wide">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>NIST FIPS 203 LATTICE CRYPTOGRAPHY</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.12]">
              End-to-End Privacy That Survives the{" "}
              <span className="text-gradient">Quantum Era.</span>
            </h1>

            {/* Sub-paragraph */}
            <p className="text-base sm:text-lg text-wa-muted max-w-2xl leading-relaxed">
              Classical RSA and Elliptic Curve encryption will be compromised by quantum computers within the decade. QuantumShield combines NIST-standardized{" "}
              <strong className="text-white font-medium">Kyber-1024</strong> lattice key encapsulation with{" "}
              <strong className="text-white font-medium">Star-Topology</strong> group re-encryption and client-isolated vaults. No phone number. Zero plaintext on servers.
            </p>

            {/* Call to Actions */}
            <div className="pt-2 flex flex-wrap items-center gap-3.5 w-full sm:w-auto">
              <button
                onClick={onLaunchApp}
                className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#005c4b] to-[#00a884] hover:from-[#00a884] hover:to-[#005c4b] text-white font-semibold shadow-xl shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.02] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 text-base"
              >
                <span>Launch Web App</span>
                <ArrowRight className="w-5 h-5" />
              </button>

              <button
                onClick={handleInstantRoom}
                disabled={creatingInstantRoom}
                className="w-full sm:w-auto px-5 py-3.5 rounded-xl glass-panel border border-cyan-500/30 hover:border-cyan-400/60 text-white font-medium hover:bg-cyan-500/10 transition-all flex items-center justify-center gap-2 text-base"
              >
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>{creatingInstantRoom ? "Creating Room..." : "Create Instant Room"}</span>
              </button>

              <a
                href="#architecture"
                className="w-full sm:w-auto px-4 py-3.5 text-sm font-medium text-wa-muted hover:text-white transition-colors text-center"
              >
                Explore Spec Sheet &darr;
              </a>
            </div>

            {/* Quick Metrics Bar */}
            <div className="pt-6 border-t border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
              <div>
                <div className="text-2xl font-bold font-mono text-white">1024-bit</div>
                <div className="text-xs text-wa-muted mt-0.5">Kyber Lattice Security</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-wa-teal">0 Bytes</div>
                <div className="text-xs text-wa-muted mt-0.5">Server Plaintext Stored</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-cyan-400">8 Peers</div>
                <div className="text-xs text-wa-muted mt-0.5">Star Group Topology</div>
              </div>
              <div>
                <div className="text-2xl font-bold font-mono text-emerald-400">&lt; 25ms</div>
                <div className="text-xs text-wa-muted mt-0.5">In-Browser Handshake</div>
              </div>
            </div>
          </div>

          {/* Right Column: INTERACTIVE PRODUCT MOCKUP */}
          <div className="lg:col-span-5 relative">
            {/* Ambient card back-glow */}
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-500/30 to-emerald-500/20 blur-xl opacity-50" />

            {/* WhatsApp Web-inspired live interactive card */}
            <div className="relative rounded-2xl bg-[#111c24] border border-white/10 shadow-2xl overflow-hidden flex flex-col">
              {/* Card Header Bar */}
              <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-cyan-900/60 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-300 text-xs">
                    QS
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <span>Confidential Channel</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </div>
                    <div className="text-[10px] font-mono text-wa-teal">
                      ML-KEM-1024 • Star Hub Active
                    </div>
                  </div>
                </div>

                {/* Plaintext vs Ciphertext Toggle */}
                <button
                  onClick={() => setShowCiphertext(!showCiphertext)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono flex items-center gap-1.5 border transition-all ${
                    showCiphertext
                      ? "bg-cyan-500/20 border-cyan-400 text-cyan-300"
                      : "bg-white/5 border-white/10 text-wa-muted hover:text-white"
                  }`}
                  title="Toggle wire view"
                >
                  {showCiphertext ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{showCiphertext ? "Raw Ciphertext" : "Plaintext"}</span>
                </button>
              </div>

              {/* Chat Canvas (Doodle Pattern Wallpaper) */}
              <div className="p-4 space-y-3.5 min-h-[260px] max-h-[300px] overflow-y-auto qs-doodle-bg flex flex-col justify-end">
                {/* Security Handshake Notification */}
                <div className="text-center my-1">
                  <span className="inline-block px-3 py-1 rounded-md bg-[#182229]/90 border border-yellow-500/20 text-[10px] text-yellow-300/90 font-mono">
                    🔒 Messages are end-to-end post-quantum protected with NIST FIPS 203.
                  </span>
                </div>

                {/* Message Bubbles */}
                {mockMessages.map((msg) => {
                  const isAlice = msg.sender === "Alice";
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isAlice ? "items-end" : "items-start"} animate-fade-in`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs shadow-md transition-all ${
                          isAlice
                            ? "bg-[#005c4b] text-white rounded-tr-none"
                            : "bg-[#202c33] text-wa-body rounded-tl-none border border-white/5"
                        }`}
                      >
                        {showCiphertext ? (
                          <div className="font-mono text-[10px] text-cyan-300 break-all select-all">
                            {msg.ciphertext}
                          </div>
                        ) : (
                          <div className="leading-relaxed">{msg.text}</div>
                        )}

                        <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-white/60 font-mono">
                          <span>{msg.time}</span>
                          {isAlice && (
                            <span>
                              {msg.status === "read" ? (
                                <CheckCheck className="w-3 h-3 text-cyan-400 inline" />
                              ) : msg.status === "delivered" ? (
                                <CheckCheck className="w-3 h-3 text-white/50 inline" />
                              ) : (
                                <Check className="w-3 h-3 text-white/40 inline" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isSimulating && (
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-400 pl-1">
                    <span className="animate-spin inline-block">⚡</span>
                    <span>Encapsulating via Kyber-1024 & streaming ciphertext...</span>
                  </div>
                )}
              </div>

              {/* Preset Quick Actions */}
              <div className="px-3 py-2 bg-[#17222a] border-t border-white/5 flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono text-wa-muted">
                <span className="text-[10px] uppercase text-wa-teal font-semibold pr-1 shrink-0">
                  Try:
                </span>
                <button
                  onClick={() => handleSendMock("Confirm post-quantum key fingerprint 8A:4F")}
                  disabled={isSimulating}
                  className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 hover:text-white transition-colors shrink-0"
                >
                  "Verify Fingerprint"
                </button>
                <button
                  onClick={() => handleSendMock("Transferring encrypted vault token...")}
                  disabled={isSimulating}
                  className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 hover:text-white transition-colors shrink-0"
                >
                  "Transmit Token"
                </button>
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMock();
                }}
                className="bg-[#1f2c34] p-2.5 flex items-center gap-2 border-t border-white/5"
              >
                <input
                  type="text"
                  placeholder="Type a test encrypted message..."
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  className="flex-1 bg-[#2a3942] text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-400 placeholder:text-wa-muted/60"
                />
                <button
                  type="submit"
                  disabled={!customInput.trim() || isSimulating}
                  className="w-8 h-8 rounded-full bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-40 text-white flex items-center justify-center transition-all"
                  aria-label="Send test message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BADGES & STANDARDS BAR */}
      <section className="relative z-10 py-8 border-y border-white/5 bg-[#080e14]/60 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6 items-center text-center">
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <Shield className="w-5 h-5 text-cyan-400" />
              <span className="text-xs font-semibold text-white">NIST FIPS 203</span>
              <span className="text-[10px] font-mono text-wa-muted">ML-KEM-1024</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <Key className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-semibold text-white">Ed25519 Identity</span>
              <span className="text-[10px] font-mono text-wa-muted">Zero Phone Numbers</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <Users className="w-5 h-5 text-cyan-400" />
              <span className="text-xs font-semibold text-white">Star Group Mesh</span>
              <span className="text-[10px] font-mono text-wa-muted">Hub Re-Encryption</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <HardDrive className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-semibold text-white">Encrypted Vault</span>
              <span className="text-[10px] font-mono text-wa-muted">Client IndexedDB</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <Radio className="w-5 h-5 text-cyan-400" />
              <span className="text-xs font-semibold text-white">Zero-Knowledge Push</span>
              <span className="text-[10px] font-mono text-wa-muted">RFC 8292 VAPID</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-wa-muted hover:text-white transition-colors">
              <Server className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-semibold text-white">Stateless Relay</span>
              <span className="text-[10px] font-mono text-wa-muted">0 Disk Logging</span>
            </div>
          </div>
        </div>
      </section>

      {/* CORE FEATURES (Alternating SaaS Layouts) */}
      <section id="features" className="relative z-10 py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-24">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <span className="text-xs font-mono tracking-widest text-wa-teal uppercase">
            Architectural Superiority
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Designed to Withstand Nation-State Adversaries
          </h2>
          <p className="text-wa-muted text-base leading-relaxed">
            Every layer of QuantumShield has been engineered to eliminate trust in third-party servers, cloud providers, and aging cryptographic standards.
          </p>
        </div>

        {/* Feature 1: Post-Quantum Lattice Key Encapsulation */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Lattice Cryptography: Immune to Shor's Algorithm
            </h3>
            <p className="text-wa-muted leading-relaxed">
              Classical messaging apps rely on ECDH (Curve25519 or secp256r1) which a quantum computer running Shor's algorithm can solve in polynomial time. QuantumShield employs{" "}
              <strong className="text-white">ML-KEM-1024</strong> (Module-Lattice Key Encapsulation Mechanism), officially standardized in NIST FIPS 203.
            </p>
            <ul className="space-y-2.5 text-sm text-wa-body font-medium">
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>NIST Security Category 5 (256-bit quantum security strength)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Harvest Now, Decrypt Later (HNDL) protection today</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Hybrid session fallback with X25519 & HKDF-SHA256</span>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-2xl glass-card p-6 border border-white/10 space-y-4">
              <div className="text-xs font-mono text-cyan-400 uppercase tracking-wider flex items-center justify-between">
                <span>Cryptographic Resilience Matrix</span>
                <span className="text-emerald-400 font-bold">100% SECURE</span>
              </div>
              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 rounded-lg bg-[#0d1526] border border-red-500/30 flex items-center justify-between">
                  <div>
                    <div className="text-red-400 font-bold">RSA-2048 & ECC (Signal / WhatsApp)</div>
                    <div className="text-[10px] text-wa-muted">Vulnerable to Shor's Quantum Algorithm</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px]">COMPROMISED</span>
                </div>
                <div className="p-3 rounded-lg bg-[#0d1526] border border-cyan-500/40 flex items-center justify-between shadow-lg shadow-cyan-500/10">
                  <div>
                    <div className="text-cyan-300 font-bold">QuantumShield ML-KEM-1024</div>
                    <div className="text-[10px] text-wa-teal">Module Learning With Errors (LWE) Lattice</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">QUANTUM PROOF</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-black/40 text-[11px] font-mono text-wa-muted border border-white/5">
                Lattice math operates on multidimensional geometry where finding the closest vector is NP-hard even for quantum systems.
              </div>
            </div>
          </div>
        </div>

        {/* Feature 2: Star Topology Group Chat with Hub Re-Encryption */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 order-2 lg:order-1">
            <div className="rounded-2xl glass-card p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between text-xs font-mono text-wa-teal">
                <span>Active Star Topology Mesh</span>
                <span>Max 8 Peers / Room</span>
              </div>
              {/* Star Topology SVG Graphic */}
              <div className="relative h-56 rounded-xl bg-[#080e14] border border-white/5 flex items-center justify-center p-4">
                <div className="relative w-48 h-48 flex items-center justify-center">
                  {/* Central Hub Node */}
                  <div className="z-10 w-16 h-16 rounded-full bg-[#005c4b] border-2 border-emerald-400 shadow-xl shadow-emerald-500/30 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] font-bold text-white font-mono">HUB</span>
                    <span className="text-[8px] text-emerald-200">Re-Encrypt</span>
                  </div>

                  {/* Satellite Spoke Nodes */}
                  <div className="absolute top-2 w-10 h-10 rounded-full bg-[#111d35] border border-cyan-400/60 flex items-center justify-center text-[10px] font-mono text-cyan-300 shadow">
                    Peer 1
                  </div>
                  <div className="absolute bottom-2 w-10 h-10 rounded-full bg-[#111d35] border border-cyan-400/60 flex items-center justify-center text-[10px] font-mono text-cyan-300 shadow">
                    Peer 2
                  </div>
                  <div className="absolute left-2 w-10 h-10 rounded-full bg-[#111d35] border border-cyan-400/60 flex items-center justify-center text-[10px] font-mono text-cyan-300 shadow">
                    Peer 3
                  </div>
                  <div className="absolute right-2 w-10 h-10 rounded-full bg-[#111d35] border border-cyan-400/60 flex items-center justify-center text-[10px] font-mono text-cyan-300 shadow">
                    Peer 4
                  </div>

                  {/* Radiating lines */}
                  <div className="absolute w-full h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
                  <div className="absolute h-full w-[1px] bg-gradient-to-b from-transparent via-cyan-500/30 to-transparent" />
                </div>
              </div>
              <p className="text-[11px] text-wa-muted font-mono leading-relaxed">
                The designated in-browser Hub receives encrypted frames, re-encrypts per spoke in RAM, and broadcasts back through the zero-knowledge wire.
              </p>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-5 order-1 lg:order-2">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Star Topology Group Chats Without Server Keys
            </h3>
            <p className="text-wa-muted leading-relaxed">
              Standard group messaging architectures either trust the cloud server with group session keys (like Telegram) or leak recipient metadata. QuantumShield uses an in-browser{" "}
              <strong className="text-white">Star Topology</strong> where the room creator re-encrypts messages client-side.
            </p>
            <ul className="space-y-2.5 text-sm text-wa-body font-medium">
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Zero server group decryption keys or plaintext retention</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Automatic Hub failover if creator disconnects</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Live participant roster with cryptographically authenticated presence</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Feature 3: Ephemeral File & Media Sharing */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-5">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              32KB Stream-Encrypted File & Image Sharing
            </h3>
            <p className="text-wa-muted leading-relaxed">
              Share confidential documents, images, and keys securely. Files are automatically segmented into 32KB chunks, encrypted with AES-256-GCM, streamed through the WebSocket wire, and reassembled in-memory with SHA-256 checksums.
            </p>
            <ul className="space-y-2.5 text-sm text-wa-body font-medium">
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Zero cloud file storage or permanent upload URLs</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>Real-time transfer progress and peer delivery acknowledgment</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-wa-teal" />
                <span>In-line image rendering directly from decrypted memory buffers</span>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-6">
            <div className="rounded-2xl glass-card p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between text-xs font-mono text-cyan-400">
                <span>In-Flight Chunk Stream</span>
                <span>SHA-256: 7b3e...9a41</span>
              </div>
              <div className="p-4 rounded-xl bg-[#0d1526] border border-white/10 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 font-bold font-mono text-xs">
                    PDF
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-white">confidential_briefing_2026.pdf</div>
                    <div className="text-[10px] font-mono text-wa-muted">2.4 MB • 75 / 75 chunks verified</div>
                  </div>
                  <CheckCheck className="w-4 h-4 text-cyan-400" />
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full w-full" />
                </div>
                <div className="text-[10px] font-mono text-wa-teal flex justify-between">
                  <span>Reassembled in RAM</span>
                  <span>Integrity Passed ✓</span>
                </div>
              </div>
              <div className="text-[11px] font-mono text-wa-muted">
                Files bypass disk writes entirely. If you close the tab, the in-memory payload evaporates.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON MATRIX (QuantumShield vs WhatsApp vs Signal vs Telegram) */}
      <section id="comparison" className="relative z-10 py-24 bg-[#080e14]/80 border-y border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="text-xs font-mono tracking-widest text-cyan-400 uppercase">
              Rigorous Evaluation
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              How QuantumShield Compares
            </h2>
            <p className="text-wa-muted text-base">
              A transparent technical comparison of privacy guarantees and threat models.
            </p>
          </div>

          {/* Responsive Comparison Table */}
          <div className="overflow-x-auto rounded-2xl border border-white/10 glass-panel">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#111d35] text-xs font-mono uppercase text-wa-muted border-b border-white/10">
                <tr>
                  <th className="py-4 px-6 text-white font-bold">Privacy / Crypto Dimension</th>
                  <th className="py-4 px-6 text-cyan-400 font-bold bg-cyan-950/30">QuantumShield</th>
                  <th className="py-4 px-6">WhatsApp</th>
                  <th className="py-4 px-6">Signal</th>
                  <th className="py-4 px-6">Telegram</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-sans">
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">Post-Quantum Resilience</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    NIST ML-KEM-1024
                  </td>
                  <td className="py-4 px-6 text-wa-muted">Vulnerable (Curve25519)</td>
                  <td className="py-4 px-6 text-wa-muted">Experimental PQXDH</td>
                  <td className="py-4 px-6 text-red-400">None (MTProto RSA)</td>
                </tr>
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">No Phone Number / KYC</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    100% Anonymous (Ed25519)
                  </td>
                  <td className="py-4 px-6 text-red-400">Mandatory Phone SIM</td>
                  <td className="py-4 px-6 text-red-400">Mandatory Phone SIM</td>
                  <td className="py-4 px-6 text-red-400">Mandatory Phone SIM</td>
                </tr>
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">Server Plaintext Stored</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    0 Bytes (Stateless Relay)
                  </td>
                  <td className="py-4 px-6 text-wa-muted">Cloud Backup Leaks</td>
                  <td className="py-4 px-6 text-emerald-400">0 Bytes</td>
                  <td className="py-4 px-6 text-red-400">Full Plaintext on Cloud</td>
                </tr>
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">Group Chat Encryption</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    Star Hub Client Re-Encrypt
                  </td>
                  <td className="py-4 px-6 text-wa-muted">Sender Keys (Metadata leaked)</td>
                  <td className="py-4 px-6 text-emerald-400">Sender Keys</td>
                  <td className="py-4 px-6 text-red-400">Unencrypted Server Mesh</td>
                </tr>
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">Self-Hostable with Docker</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    Yes (Single Command)
                  </td>
                  <td className="py-4 px-6 text-red-400">Proprietary Meta Infra</td>
                  <td className="py-4 px-6 text-red-400">Complex Monolithic Server</td>
                  <td className="py-4 px-6 text-red-400">Proprietary Closed Infra</td>
                </tr>
                <tr className="hover:bg-white/[0.02]">
                  <td className="py-4 px-6 font-medium text-white">Push Notifications Privacy</td>
                  <td className="py-4 px-6 font-semibold text-emerald-400 bg-cyan-950/20">
                    Zero-Knowledge Wake Pings
                  </td>
                  <td className="py-4 px-6 text-wa-muted">Sender metadata exposed</td>
                  <td className="py-4 px-6 text-wa-muted">FCM/APNs metadata</td>
                  <td className="py-4 px-6 text-red-400">Plaintext previews</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CRYPTOGRAPHIC PIPELINE WALKTHROUGH */}
      <section id="pipeline" className="relative z-10 py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <span className="text-xs font-mono tracking-widest text-wa-teal uppercase">
            Protocol Mechanics
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            How Every Message is Shielded
          </h2>
          <p className="text-wa-muted text-base">
            Click through the 5-phase cryptographic lifecycle that runs seamlessly inside your browser.
          </p>
        </div>

        {/* Step Selector Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {pipelineSteps.map((s) => (
            <button
              key={s.num}
              onClick={() => setActivePipelineStep(s.num)}
              className={`px-4 py-2 rounded-xl text-xs font-mono transition-all border ${
                activePipelineStep === s.num
                  ? "bg-cyan-500/20 border-cyan-400 text-white font-bold shadow-lg shadow-cyan-500/20"
                  : "glass-panel border-white/5 text-wa-muted hover:text-white"
              }`}
            >
              Step {s.num}: {s.title.split("(")[0]}
            </button>
          ))}
        </div>

        {/* Active Step Display Card */}
        {(() => {
          const step = pipelineSteps[activePipelineStep - 1];
          return (
            <div className="max-w-4xl mx-auto rounded-2xl glass-card p-6 sm:p-8 border border-white/10 grid grid-cols-1 md:grid-cols-12 gap-8 items-center animate-fade-in">
              <div className="md:col-span-7 space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
                  <span>Phase {step.num} of 5</span>
                  <span>•</span>
                  <span>{step.subtitle}</span>
                </div>
                <h3 className="text-2xl font-bold text-white">{step.title}</h3>
                <p className="text-wa-muted text-sm leading-relaxed">{step.desc}</p>
                <div className="flex items-center gap-4 text-xs font-mono text-cyan-400 pt-2">
                  <span className="flex items-center gap-1.5">
                    <CheckCheck className="w-4 h-4 text-wa-teal" />
                    <span>Hardware WebCrypto sandbox</span>
                  </span>
                </div>
              </div>

              <div className="md:col-span-5">
                <div className="rounded-xl bg-[#080e14] border border-white/10 p-4 font-mono text-xs space-y-2 text-wa-teal">
                  <div className="flex items-center justify-between text-[10px] text-wa-muted border-b border-white/5 pb-2">
                    <span>BROWSER CONTEXT</span>
                    <span>ACTIVE BUFFER</span>
                  </div>
                  <pre className="text-cyan-300 text-[11px] leading-relaxed whitespace-pre-wrap">
                    {step.code}
                  </pre>
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* FREQUENTLY ASKED QUESTIONS (Accordion) */}
      <section id="faq" className="relative z-10 py-24 bg-[#080e14]/60 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-3">
            <span className="text-xs font-mono tracking-widest text-cyan-400 uppercase">
              Got Questions?
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-wa-muted text-base">
              Everything you need to know about post-quantum security and operational guarantees.
            </p>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className="rounded-xl glass-card border border-white/5 overflow-hidden transition-all"
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 text-sm font-semibold text-white hover:text-cyan-400 transition-colors"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-wa-muted shrink-0 transition-transform duration-200 ${
                        isOpen ? "rotate-180 text-cyan-400" : ""
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-wa-muted leading-relaxed border-t border-white/5 pt-3 animate-fade-in">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FINAL HIGH-IMPACT CALL TO ACTION */}
      <section className="relative z-10 py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl overflow-hidden p-8 sm:p-14 text-center border border-emerald-500/30 shadow-2xl shadow-emerald-500/10 bg-gradient-to-b from-[#0d1f2d] via-[#091520] to-[#050910]">
          {/* Internal ambient radial */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/15 blur-[100px] pointer-events-none" />

          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
              <Lock className="w-3.5 h-3.5" />
              <span>Zero Setup • Zero Friction</span>
            </div>

            <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
              Ready to Communicate Without Compromise?
            </h2>

            <p className="text-wa-muted text-base sm:text-lg leading-relaxed">
              Launch QuantumShield right in your browser. Create an encrypted room in 2 seconds or deploy your own sovereign relay node.
            </p>

            <div className="pt-2 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={onLaunchApp}
                className="px-8 py-4 rounded-xl bg-gradient-to-r from-[#005c4b] to-[#00a884] hover:from-[#00a884] hover:to-[#005c4b] text-white font-bold text-base shadow-xl shadow-emerald-500/25 hover:shadow-emerald-500/35 hover:scale-[1.02] transition-all flex items-center gap-2.5"
              >
                <span>Launch QuantumShield Web</span>
                <ArrowRight className="w-5 h-5" />
              </button>

              <a
                href="https://github.com/BaggaByte/QuantumShield"
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-4 rounded-xl glass-panel border border-white/10 hover:border-white/20 text-white font-medium text-base hover:bg-white/5 transition-all flex items-center gap-2"
              >
                <span>Deploy with Docker</span>
                <ExternalLink className="w-4 h-4 text-wa-muted" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* COMPLETE SAAS FOOTER */}
      <footer className="relative z-10 border-t border-white/5 bg-[#03060a] pt-16 pb-12 text-xs text-wa-muted">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 pb-12 border-b border-white/5">
            {/* Col 1: Brand Info */}
            <div className="col-span-2 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-[#0d1526] border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                  <Shield className="w-4 h-4" />
                </div>
                <span className="font-bold text-white text-sm tracking-wider">QUANTUMSHIELD</span>
              </div>
              <p className="text-xs text-wa-muted max-w-sm leading-relaxed">
                Post-quantum end-to-end encrypted messaging designed for high-assurance confidentiality, zero cloud plaintext, and autonomous cryptographic sovereignty.
              </p>
              <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Zero-Knowledge Relay Operational</span>
              </div>
            </div>

            {/* Col 2: Architecture */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Architecture
              </div>
              <ul className="space-y-2">
                <li><a href="#pipeline" className="hover:text-cyan-400 transition-colors">ML-KEM-1024</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">Star Topology</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">Client IndexedDB</a></li>
                <li><a href="#features" className="hover:text-cyan-400 transition-colors">32KB Chunking</a></li>
              </ul>
            </div>

            {/* Col 3: Standards */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Standards
              </div>
              <ul className="space-y-2">
                <li><span className="text-wa-body">NIST FIPS 203</span></li>
                <li><span className="text-wa-body">RFC 8292 VAPID</span></li>
                <li><span className="text-wa-body">W3C WebCrypto</span></li>
                <li><span className="text-wa-body">AES-256-GCM</span></li>
              </ul>
            </div>

            {/* Col 4: Resources */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Resources
              </div>
              <ul className="space-y-2">
                <li>
                  <a
                    href="https://github.com/BaggaByte/QuantumShield"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyan-400 transition-colors flex items-center gap-1"
                  >
                    <span>GitHub Repo</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li>
                  <a
                    href="https://csrc.nist.gov/pubs/fips/203/final"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyan-400 transition-colors flex items-center gap-1"
                  >
                    <span>NIST Spec</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </li>
                <li><a href="#faq" className="hover:text-cyan-400 transition-colors">FAQ</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom Legal / Copyright Bar */}
          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-wa-muted">
            <div>
              &copy; {new Date().getFullYear()} QuantumShield. All Rights Reserved. Proprietary Post-Quantum Architecture.
            </div>
            <div className="flex items-center gap-4 font-mono">
              <span>NIST Category 5</span>
              <span>•</span>
              <span>Zero Logs</span>
              <span>•</span>
              <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="hover:text-white">
                Back to Top &uarr;
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

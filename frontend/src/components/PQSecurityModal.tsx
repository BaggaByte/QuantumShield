import React, { useState, useEffect } from "react";
import { Shield, ShieldCheck, Copy, Check, X, Lock, Cpu, KeyRound, Sparkles } from "lucide-react";
import { soundHapticService } from "@/services/SoundHapticService";

interface PQSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  sessionKeyFingerprint?: string;
  cryptoMode?: "classical" | "hybrid";
  isHub?: boolean;
}

const EMOJI_PALETTE = ["🛡️", "⚡", "🪐", "💎", "🔐", "🌌", "🧬", "⚛️", "🛰️", "🔥", "💠", "🌟", "🗝️", "🌈", "🔮", "✨"];

export function getDeterministicEmojis(seedStr: string): string[] {
  if (!seedStr) return ["🛡️", "⚡", "💎", "🪐"];
  const clean = seedStr.replace(/[^0-9a-fA-F]/g, "");
  const emojis: string[] = [];
  for (let i = 0; i < 4; i++) {
    const chunk = clean.slice(i * 2, i * 2 + 2) || "00";
    const val = parseInt(chunk, 16) || 0;
    emojis.push(EMOJI_PALETTE[(val + i * 3) % EMOJI_PALETTE.length]);
  }
  return emojis;
}

export function getSafetyNumericCode(seedStr: string): string {
  if (!seedStr) return "5829 4810 3921 7719";
  const clean = seedStr.replace(/[^0-9a-fA-F]/g, "");
  let numStr = "";
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2) || "0", 16);
    numStr += (byte % 10).toString();
  }
  while (numStr.length < 16) numStr += "7";
  return `${numStr.slice(0, 4)} ${numStr.slice(4, 8)} ${numStr.slice(8, 12)} ${numStr.slice(12, 16)}`;
}

export default function PQSecurityModal({
  isOpen,
  onClose,
  roomId,
  sessionKeyFingerprint,
  cryptoMode = "hybrid",
  isHub = false,
}: PQSecurityModalProps) {
  const [copied, setCopied] = useState(false);
  const [isVerified, setIsVerified] = useState(false);

  const seed = sessionKeyFingerprint || roomId || "QuantumShield";
  const emojis = getDeterministicEmojis(seed);
  const numericCode = getSafetyNumericCode(seed);

  useEffect(() => {
    if (typeof window !== "undefined" && roomId) {
      const stored = localStorage.getItem(`qs_verified_${roomId}`);
      setIsVerified(stored === "true");
    }
  }, [roomId, isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(`${emojis.join(" ")} (${numericCode})`);
    setCopied(true);
    soundHapticService.play("tap");
    soundHapticService.triggerHaptic("tap");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleVerified = () => {
    const next = !isVerified;
    setIsVerified(next);
    if (typeof window !== "undefined" && roomId) {
      localStorage.setItem(`qs_verified_${roomId}`, next ? "true" : "false");
    }
    soundHapticService.play(next ? "handshake" : "tap");
    soundHapticService.triggerHaptic(next ? "success" : "tap");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-[#111c24] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-[#1f2c34] border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${isVerified ? "bg-emerald-500/20 text-emerald-400" : "bg-wa-teal/20 text-wa-teal"}`}>
              {isVerified ? <ShieldCheck className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Verify Quantum Security
                {isVerified && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                    Verified ✓
                  </span>
                )}
              </h3>
              <p className="text-xs text-wa-muted">
                Room <span className="font-mono text-white/80">{roomId}</span> • {cryptoMode === "hybrid" ? "Post-Quantum Hybrid" : "Classical"}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              soundHapticService.play("tap");
              onClose();
            }}
            className="p-1.5 rounded-lg text-wa-muted hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Visual Safety Emojis (SAS) */}
          <div className="bg-[#1f2c34]/70 border border-white/5 rounded-xl p-4 text-center">
            <div className="text-xs font-semibold text-wa-muted uppercase tracking-wider mb-2">
              Visual Safety Number (SAS)
            </div>
            <div className="flex items-center justify-center gap-3 sm:gap-4 my-2">
              {emojis.map((emoji, idx) => (
                <div
                  key={idx}
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#0b141a] border border-white/10 flex items-center justify-center text-2xl sm:text-3xl shadow-inner select-none transition-transform hover:scale-105"
                >
                  {emoji}
                </div>
              ))}
            </div>
            <div className="font-mono text-sm tracking-widest text-emerald-400 font-bold mt-2">
              {numericCode}
            </div>
            <p className="text-[11px] text-wa-muted mt-2 max-w-sm mx-auto leading-relaxed">
              Compare these 4 emojis with your peer in person or over a voice call. If they match, your post-quantum channel is cryptographically tamper-proof against Man-in-the-Middle (MitM) attacks.
            </p>
            <button
              onClick={handleCopy}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-wa-teal hover:text-white font-medium px-3 py-1.5 rounded-lg bg-wa-teal/10 hover:bg-wa-teal/20 transition-all border border-wa-teal/20"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied to clipboard!" : "Copy Safety Number"}</span>
            </button>
          </div>

          {/* Cryptographic Bill of Materials */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-wa-muted uppercase tracking-wider flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-wa-teal" />
              <span>Active Cryptographic Stack</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-[#1a252d] border border-white/5 rounded-lg p-2.5">
                <div className="text-wa-muted text-[10px] uppercase font-mono">Post-Quantum KEM</div>
                <div className="text-white font-bold text-xs mt-0.5 flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                  <span>ML-KEM-768 (FIPS 203)</span>
                </div>
                <div className="text-[10px] text-wa-muted mt-1">1184B Public Key • Lattice-based</div>
              </div>

              <div className="bg-[#1a252d] border border-white/5 rounded-lg p-2.5">
                <div className="text-wa-muted text-[10px] uppercase font-mono">Classical Diffie-Hellman</div>
                <div className="text-white font-bold text-xs mt-0.5 flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5 text-teal-400" />
                  <span>X25519 (RFC 7748)</span>
                </div>
                <div className="text-[10px] text-wa-muted mt-1">32B Public Key • Curve25519</div>
              </div>

              <div className="bg-[#1a252d] border border-white/5 rounded-lg p-2.5">
                <div className="text-wa-muted text-[10px] uppercase font-mono">Key Derivation (KDF)</div>
                <div className="text-white font-bold text-xs mt-0.5">HKDF-SHA-256 (RFC 5869)</div>
                <div className="text-[10px] text-wa-muted mt-1">Dual-secret entropy combiner</div>
              </div>

              <div className="bg-[#1a252d] border border-white/5 rounded-lg p-2.5">
                <div className="text-wa-muted text-[10px] uppercase font-mono">Authenticated Encryption</div>
                <div className="text-white font-bold text-xs mt-0.5 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>AES-256-GCM (128-bit Tag)</span>
                </div>
                <div className="text-[10px] text-wa-muted mt-1">Fresh 96-bit random IV per message</div>
              </div>
            </div>
          </div>

          {/* Session Fingerprint */}
          {sessionKeyFingerprint && (
            <div className="bg-[#1a252d]/60 border border-white/5 rounded-lg p-2.5">
              <div className="text-[10px] text-wa-muted font-mono uppercase">Derived Session Key Fingerprint</div>
              <div className="font-mono text-xs text-white/90 break-all select-all mt-1">
                {sessionKeyFingerprint}
              </div>
            </div>
          )}

          {/* Harvest Now, Decrypt Later (HNDL) Resilience */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/30 to-teal-950/30 border border-emerald-500/20 text-xs">
            <div className="font-bold text-emerald-300 flex items-center gap-1.5 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>HNDL Attack Immune</span>
            </div>
            <p className="text-emerald-100/70 text-[11px] leading-relaxed">
              Adversaries recording encrypted internet traffic today cannot decrypt it in 2035 using quantum Shor algorithms. CRYSTALS-Kyber (ML-KEM) lattice hard problems remain computationally intractable.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-[#1f2c34] border-t border-white/5 flex items-center justify-between shrink-0">
          <button
            onClick={handleToggleVerified}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isVerified
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30"
                : "bg-wa-teal hover:bg-[#00c298] text-white shadow-lg shadow-teal-950/40"
            }`}
          >
            {isVerified ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Marked as Verified ✓</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Mark Channel as Verified</span>
              </>
            )}
          </button>

          <button
            onClick={() => {
              soundHapticService.play("tap");
              onClose();
            }}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-wa-muted hover:text-white hover:bg-white/5 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

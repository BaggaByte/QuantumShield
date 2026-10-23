import React, { useState } from "react";
import {
  ArrowRight, RefreshCw, Shield, Lock, Key, AlertTriangle, CheckCircle, XCircle
} from "lucide-react";
import {
  generateX25519KeyPair, generateMLKEMKeyPair, mlkemEncapsulate, mlkemDecapsulate,
  x25519SharedSecret, deriveSessionKey, encryptMessage, decryptMessage,
  bytesToBase64, bytesToHex, KEY_SIZES
} from "@/crypto/hybrid";
import type { CryptoMode } from "@/types";

type Step = "keygen" | "exchange" | "derive" | "encrypt" | "tamper";

export default function ExplorerPage() {
  const [mode, setMode] = useState<CryptoMode>("hybrid");
  const [step, setStep] = useState<Step>("keygen");
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<Record<string, unknown>>({});
  const [tampering, setTampering] = useState(false);
  const [tamperResult, setTamperResult] = useState<string | null>(null);

  const sessionId = "explorer-demo";
  const samplePlaintext = "Hello, post-quantum world!";

  const runStep = async (s: Step) => {
    setRunning(true);
    setTamperResult(null);
    try {
      if (s === "keygen") {
        const aliceX25519 = generateX25519KeyPair();
        const bobX25519 = generateX25519KeyPair();
        let aliceMLKEM = null, bobMLKEM = null;
        if (mode === "hybrid") {
          aliceMLKEM = generateMLKEMKeyPair();
          bobMLKEM = generateMLKEMKeyPair();
        }
        setState({ aliceX25519, bobX25519, aliceMLKEM, bobMLKEM, step: "keygen" });
        setStep("exchange");
      } else if (s === "exchange") {
        const { aliceX25519, bobX25519, bobMLKEM } = state as {
          aliceX25519: { privateKey: Uint8Array; publicKey: Uint8Array };
          bobX25519: { privateKey: Uint8Array; publicKey: Uint8Array };
          bobMLKEM?: { publicKey: Uint8Array; secretKey: Uint8Array };
        };
        const aliceSS = x25519SharedSecret(aliceX25519.privateKey, bobX25519.publicKey);
        const bobSS = x25519SharedSecret(bobX25519.privateKey, aliceX25519.publicKey);
        let aliceMLKEMEnc = null, aliceMLKEMSS = null, bobMLKEMSS = null;
        if (mode === "hybrid" && bobMLKEM) {
          const enc = mlkemEncapsulate(bobMLKEM.publicKey);
          aliceMLKEMEnc = enc.ciphertext;
          aliceMLKEMSS = enc.sharedSecret;
          bobMLKEMSS = mlkemDecapsulate(enc.ciphertext, bobMLKEM.secretKey);
        }
        setState(prev => ({ ...prev, aliceSS, bobSS, aliceMLKEMEnc, aliceMLKEMSS, bobMLKEMSS, step: "exchange" }));
        setStep("derive");
      } else if (s === "derive") {
        const { aliceSS, aliceMLKEMSS, bobSS, bobMLKEMSS } = state as {
          aliceSS: Uint8Array; bobSS: Uint8Array;
          aliceMLKEMSS?: Uint8Array; bobMLKEMSS?: Uint8Array;
        };
        const aliceKey = await deriveSessionKey(aliceSS, sessionId, mode, aliceMLKEMSS);
        const bobKey = await deriveSessionKey(bobSS, sessionId, mode, bobMLKEMSS);
        setState(prev => ({ ...prev, aliceKey, bobKey, step: "derive" }));
        setStep("encrypt");
      } else if (s === "encrypt") {
        const { aliceKey } = state as { aliceKey: { keyBytes: Uint8Array; fingerprint: string } };
        const aad = new TextEncoder().encode("explorer-demo");
        const enc = await encryptMessage(samplePlaintext, aliceKey.keyBytes, aad);
        const { bobKey } = state as { bobKey: { keyBytes: Uint8Array } };
        const dec = await decryptMessage(enc.ciphertext, bobKey.keyBytes, aad);
        setState(prev => ({ ...prev, enc, dec, step: "encrypt" }));
        setStep("tamper");
      }
    } finally {
      setRunning(false);
    }
  };

  const runTamper = async () => {
    const { aliceKey } = state as { aliceKey?: { keyBytes: Uint8Array } };
    const { enc } = state as { enc?: { ciphertext: string } };
    if (!enc || !aliceKey) return;
    setTampering(true);
    setTamperResult(null);
    try {
      // Flip a byte in the ciphertext
      const bytes = Uint8Array.from(atob(enc.ciphertext), c => c.charCodeAt(0));
      bytes[20] ^= 0xFF; // tamper
      const tampered = btoa(String.fromCharCode(...bytes));
      const aad = new TextEncoder().encode("explorer-demo");
      await decryptMessage(tampered, aliceKey.keyBytes, aad);
      setTamperResult("ERROR: Tampered ciphertext was NOT rejected. This is a bug.");
    } catch {
      setTamperResult("? Tampered ciphertext correctly rejected by AES-256-GCM authentication tag verification.");
    } finally {
      setTampering(false);
    }
  };

  const HexDisplay = ({ label, bytes, maxBytes = 16 }: { label: string; bytes?: Uint8Array; maxBytes?: number }) => {
    if (!bytes) return null;
    const hex = bytesToHex(bytes.slice(0, maxBytes));
    const truncated = bytes.length > maxBytes;
    return (
      <div className="bg-navy-900 rounded-lg p-3 space-y-1">
        <p className="text-xs text-slate-500">{label} <span className="text-slate-600">({bytes.length} bytes)</span></p>
        <p className="font-mono text-xs text-cyan-300 break-all">{hex}{truncated ? "…" : ""}</p>
      </div>
    );
  };

  const steps: { id: Step; label: string; desc: string }[] = [
    { id: "keygen", label: "Key Generation", desc: "Generate ephemeral key pairs" },
    { id: "exchange", label: "Key Exchange", desc: "X25519 DH + ML-KEM encapsulation" },
    { id: "derive", label: "Key Derivation", desc: "HKDF-SHA-256 session key" },
    { id: "encrypt", label: "Encryption", desc: "AES-256-GCM message encryption" },
    { id: "tamper", label: "Tamper Demo", desc: "Authentication tag verification" },
  ];

  const completedSteps = steps.findIndex(s => s.id === step);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cryptography Explorer</h1>
          <p className="text-slate-400 text-sm mt-1">Interactive visualization of the handshake protocol</p>
        </div>
        <div className="flex items-center gap-3">
          {(["classical", "hybrid"] as CryptoMode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); setStep("keygen"); setState({}); setTamperResult(null); }}
              className={`px-4 py-1.5 rounded-lg border text-sm transition-colors ${mode === m
                ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-400"
                : "border-white/10 text-slate-400 hover:border-white/20"
              }`}>
              {m === "classical" ? "Classical" : "Hybrid PQ"}
            </button>
          ))}
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-400 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        Educational visualizer only. Real key material is generated in your browser for demonstration purposes.
        This does not constitute a security audit or certification.
      </div>

      {/* Flow Diagram */}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-6 overflow-x-auto">
        <div className="flex items-center gap-3 min-w-max">
          <div className="text-center">
            <div className="w-16 h-16 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
              <span className="text-cyan-400 font-bold text-sm">Alice</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">Initiator</p>
          </div>
          {[
            `X25519 pubkey${mode === "hybrid" ? " + ML-KEM pk" : ""}`,
            `X25519 pubkey${mode === "hybrid" ? " + ML-KEM CT" : ""}`,
            "Encrypted messages",
          ].map((label, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center gap-1">
                <ArrowRight className={`w-5 h-5 ${i === 1 ? "rotate-180 text-teal-400" : "text-cyan-400"}`} />
                <span className="text-xs text-slate-400 max-w-24 text-center">{label}</span>
              </div>
              {i < 2 && <div className="w-2" />}
            </React.Fragment>
          ))}
          <div className="text-center">
            <div className="w-16 h-16 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center">
              <span className="text-teal-400 font-bold text-sm">Bob</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">Responder</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-6 text-xs flex-wrap">
          {[
            { label: "X25519 public key", size: `${KEY_SIZES.x25519.publicKey}B` },
            ...(mode === "hybrid" ? [
              { label: "ML-KEM-768 public key", size: `${KEY_SIZES.mlkem768.publicKey}B` },
              { label: "ML-KEM-768 ciphertext", size: `${KEY_SIZES.mlkem768.ciphertext}B` },
            ] : []),
            { label: "Derived session key", size: "256-bit" },
            { label: "AES-GCM nonce", size: "96-bit" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span className="text-slate-400">{item.label}:</span>
              <span className="text-cyan-400 font-mono">{item.size}</span>
            </div>
          ))}
          <div className="text-slate-500">
            Total handshake: <span className="text-cyan-400 font-mono">
              {mode === "hybrid"
                ? `${KEY_SIZES.x25519.publicKey * 2 + KEY_SIZES.mlkem768.publicKey + KEY_SIZES.mlkem768.ciphertext}B`
                : `${KEY_SIZES.x25519.publicKey * 2}B`
              }
            </span>
          </div>
        </div>
      </div>

      {/* Step Timeline */}
      <div className="bg-navy-800 border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-0">
          {steps.map((s, i) => (
            <React.Fragment key={s.id}>
              <div className={`flex flex-col items-center text-center ${i <= completedSteps - 1 ? "opacity-100" : "opacity-50"}`}>
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold ${i < completedSteps ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : i === completedSteps ? "border-cyan-500 bg-cyan-500/20 text-cyan-400" : "border-white/20 text-slate-500"}`}>
                  {i < completedSteps ? "?" : i + 1}
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-16">{s.label}</p>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${i < completedSteps - 1 ? "bg-emerald-500/40" : "bg-white/10"}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Action & Results */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          {step !== "tamper" ? (
            <button onClick={() => runStep(step)} disabled={running}
              className="w-full py-3 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 font-medium flex items-center justify-center gap-2 hover:bg-cyan-500/25 transition-colors disabled:opacity-50">
              {running ? <><RefreshCw className="w-4 h-4 animate-spin" /> Running…</> : `Run: ${steps[completedSteps]?.label}`}
            </button>
          ) : (
            <div className="space-y-3">
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                <p className="text-emerald-400 text-sm font-medium flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> Protocol Complete!
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Both parties derived identical session keys. AES-256-GCM encryption and decryption succeeded.
                </p>
              </div>
              <button onClick={runTamper} disabled={tampering}
                className="w-full py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 font-medium flex items-center justify-center gap-2 hover:bg-red-500/20 transition-colors disabled:opacity-50">
                <AlertTriangle className="w-4 h-4" /> Demo: Tamper with Ciphertext
              </button>
              {tamperResult && (
                <div className={`p-3 rounded-lg text-xs ${tamperResult.startsWith("?") ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-red-500/10 border border-red-500/20 text-red-400"}`}>
                  {tamperResult}
                </div>
              )}
              <button onClick={() => { setStep("keygen"); setState({}); setTamperResult(null); }}
                className="w-full py-2 rounded-xl border border-white/10 text-slate-400 text-sm hover:border-white/20 transition-colors">
                Reset Demo
              </button>
            </div>
          )}
        </div>

        {/* Key Material Display */}
        <div className="space-y-3">
          {(state as Record<string, Uint8Array & { privateKey?: Uint8Array; publicKey?: Uint8Array; fingerprint?: string; keyBytes?: Uint8Array }>)?.aliceX25519 && (
            <HexDisplay label="Alice X25519 public key" bytes={(state as { aliceX25519: { publicKey: Uint8Array } }).aliceX25519.publicKey} />
          )}
          {mode === "hybrid" && (state as { bobMLKEM?: { publicKey: Uint8Array } })?.bobMLKEM && (
            <HexDisplay label="Bob ML-KEM-768 public key" bytes={(state as { bobMLKEM: { publicKey: Uint8Array } }).bobMLKEM.publicKey} />
          )}
          {mode === "hybrid" && (state as { aliceMLKEMEnc?: Uint8Array })?.aliceMLKEMEnc && (
            <HexDisplay label="ML-KEM-768 ciphertext (CT)" bytes={(state as { aliceMLKEMEnc: Uint8Array }).aliceMLKEMEnc} />
          )}
          {(state as { aliceKey?: { fingerprint: string; keyBytes: Uint8Array } })?.aliceKey && (
            <div className="bg-navy-900 rounded-lg p-3 space-y-1">
              <p className="text-xs text-slate-500">Derived session key fingerprint (SHA-256 prefix)</p>
              <p className="font-mono text-xs text-emerald-400">{(state as { aliceKey: { fingerprint: string } }).aliceKey.fingerprint}</p>
              <p className="text-xs text-slate-500 mt-1">Both Alice and Bob derive the same key ?</p>
            </div>
          )}
          {(state as { enc?: { ciphertext: string; durationMs: number } })?.enc && (
            <div className="bg-navy-900 rounded-lg p-3 space-y-1">
              <p className="text-xs text-slate-500">AES-256-GCM encrypted output (truncated)</p>
              <p className="font-mono text-xs text-amber-400 break-all">{(state as { enc: { ciphertext: string } }).enc.ciphertext.slice(0, 40)}…</p>
              <p className="text-xs text-emerald-400">? Decrypted: "{samplePlaintext}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );


}


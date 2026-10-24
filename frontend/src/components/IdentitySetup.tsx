/**
 * QuantumShield - Identity Setup Modal
 *
 * Shown on first launch when no identity exists in localStorage.
 * User picks an optional display name; their cryptographic identity
 * is generated automatically. They can skip the alias entirely.
 *
 * Design: full-screen dark overlay, glassmorphic card, animated fingerprint reveal.
 */

import React, { useState } from 'react';
import { Shield, Fingerprint, Sparkles, ArrowRight, Loader2 } from 'lucide-react';

interface IdentitySetupProps {
  onComplete: (alias: string) => Promise<void>;
}

export default function IdentitySetup({ onComplete }: IdentitySetupProps) {
  const [alias, setAlias] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [step, setStep] = useState<'welcome' | 'name' | 'generating'>('welcome');

  const handleGenerate = async () => {
    setStep('generating');
    setIsGenerating(true);
    try {
      await onComplete(alias);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/95 backdrop-blur-sm">
      {/* Animated background grid */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(rgba(6,182,212,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.3) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Radial glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)' }}
      />

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-navy-900/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl"
          style={{ boxShadow: '0 0 80px rgba(6,182,212,0.1), 0 25px 50px rgba(0,0,0,0.5)' }}
        >
          {/* Welcome Step */}
          {step === 'welcome' && (
            <div className="space-y-6 animate-fade-in">
              {/* Icon */}
              <div className="flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-cyan-500/20 blur-xl animate-pulse" />
                  <div className="relative p-5 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30">
                    <Shield className="w-10 h-10 text-cyan-400" />
                  </div>
                </div>
              </div>

              {/* Heading */}
              <div className="text-center space-y-3">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-400">QuantumShield</span>
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Unlike other messengers, <strong className="text-white">you don't need an account</strong>.
                  Your identity is a cryptographic keypair that lives only in your browser.
                </p>
              </div>

              {/* Feature pills */}
              <div className="space-y-2">
                {[
                  { icon: '🔑', text: 'Your identity is your public key — nothing else' },
                  { icon: '🌐', text: 'No phone number. No email. No server.' },
                  { icon: '⚛️', text: 'Quantum-resistant by design' },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 bg-white/5 rounded-xl border border-white/5">
                    <span className="text-lg">{f.icon}</span>
                    <span className="text-sm text-slate-300">{f.text}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep('name')}
                className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-[1.01]"
              >
                Create My Identity
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Name Step */}
          {step === 'name' && (
            <div className="space-y-6 animate-fade-in">
              <div className="flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl animate-pulse" />
                  <div className="relative p-5 rounded-2xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20 border border-violet-500/30">
                    <Fingerprint className="w-10 h-10 text-violet-400" />
                  </div>
                </div>
              </div>

              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-white">Choose a Display Name</h2>
                <p className="text-slate-400 text-sm">
                  Optional — your cryptographic fingerprint is always your real identity.
                </p>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={alias}
                  onChange={e => setAlias(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                  placeholder="e.g. Alice, Bob, Shadow..."
                  maxLength={32}
                  autoFocus
                  className="w-full px-4 py-3.5 bg-navy-950/60 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 transition-all text-sm"
                />
                <p className="text-xs text-slate-600 text-center">
                  Stored only on your device. Never sent to any server.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('welcome')}
                  className="flex-1 py-3 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium transition-all border border-white/5"
                >
                  Back
                </button>
                <button
                  onClick={handleGenerate}
                  className="flex-[2] flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/20 hover:scale-[1.01] text-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate Keypair
                </button>
              </div>
            </div>
          )}

          {/* Generating Step */}
          {step === 'generating' && (
            <div className="space-y-6 animate-fade-in py-4">
              <div className="flex justify-center">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                  <div className="relative p-5 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30">
                    <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
                  </div>
                </div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-bold text-white">Generating Your Identity</h2>
                <p className="text-slate-400 text-sm">Creating Ed25519 keypair in your browser...</p>
              </div>
              <div className="space-y-2">
                {[
                  'Seeding CSPRNG from browser entropy',
                  'Generating Ed25519 signing keypair',
                  'Computing identity fingerprint',
                  'Securing to local storage',
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2">
                    <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin flex-shrink-0" />
                    <span className="text-xs text-slate-400 font-mono">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        {step !== 'generating' && (
          <p className="text-center text-xs text-slate-600 mt-4">
            Your private key never leaves your browser.{' '}
            <span className="text-slate-500">QuantumShield cannot recover it if lost.</span>
          </p>
        )}
      </div>
    </div>
  );
}

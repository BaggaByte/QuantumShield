import React, { useState, useEffect } from "react";
import { Shield, Lock } from "lucide-react";

interface PreloaderProps {
  onFinish?: () => void;
  duration?: number;
}

export default function Preloader({ onFinish, duration = 1400 }: PreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Initializing Kyber-1024 Lattice Parameters...");
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Reduced motion check
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      if (onFinish) onFinish();
      return;
    }

    const interval = 20;
    const steps = duration / interval;
    let currentStep = 0;

    const timer = setInterval(() => {
      currentStep++;
      const currentProgress = Math.min(100, Math.round((currentStep / steps) * 100));
      setProgress(currentProgress);

      if (currentProgress > 30 && currentProgress <= 70) {
        setStatusText("Verifying Browser WebCrypto Sandbox...");
      } else if (currentProgress > 70) {
        setStatusText("Zero-Knowledge Secure Gateway Ready");
      }

      if (currentStep >= steps) {
        clearInterval(timer);
        setIsExiting(true);
        setTimeout(() => {
          if (onFinish) onFinish();
        }, 350);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [duration, onFinish]);

  const handleSkip = () => {
    setIsExiting(true);
    setTimeout(() => {
      if (onFinish) onFinish();
    }, 150);
  };

  return (
    <div
      onClick={handleSkip}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050910] text-wa-body transition-all duration-300 select-none cursor-pointer ${
        isExiting ? "opacity-0 scale-105 pointer-events-none" : "opacity-100 scale-100"
      }`}
      aria-label="QuantumShield initialization screen"
    >
      {/* Background ambient radial glow */}
      <div className="absolute w-[450px] h-[450px] rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none animate-pulse-glow" />
      <div className="absolute w-[300px] h-[300px] rounded-full bg-[#00a884]/15 blur-[80px] pointer-events-none" />

      {/* Brand Icon & Outer Geometric Pulse Rings */}
      <div className="relative mb-8 flex items-center justify-center">
        {/* Animated Concentric Rings */}
        <div className="absolute w-28 h-28 rounded-full border border-cyan-500/20 animate-ping opacity-30" />
        <div className="absolute w-24 h-24 rounded-full border border-emerald-500/30 animate-spin-slow opacity-60" />
        <div className="absolute w-20 h-20 rounded-full bg-gradient-to-tr from-cyan-500/20 to-emerald-500/20 blur-md" />

        {/* Shield Glyph Card */}
        <div className="relative z-10 w-16 h-16 rounded-2xl bg-[#0d1526] border border-cyan-500/40 shadow-2xl shadow-cyan-500/20 flex items-center justify-center group">
          <Shield className="w-8 h-8 text-cyan-400 group-hover:scale-110 transition-transform" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Lock className="w-3.5 h-3.5 text-emerald-400 opacity-90" />
          </div>
        </div>
      </div>

      {/* Brand Wordmark & Security Standard */}
      <div className="text-center mb-6 z-10">
        <h1 className="text-xl md:text-2xl font-bold tracking-wider text-white flex items-center justify-center gap-2">
          <span>QUANTUM</span>
          <span className="text-cyan-400">SHIELD</span>
        </h1>
        <p className="text-[11px] font-mono tracking-widest uppercase text-wa-teal mt-1">
          NIST FIPS 203 • ML-KEM-1024
        </p>
      </div>

      {/* Sleek Progress Bar Container */}
      <div className="w-64 max-w-[80vw] z-10">
        <div className="h-1.5 w-full bg-[#111d35] rounded-full overflow-hidden border border-white/5 relative">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-cyan-400 to-cyan-300 rounded-full transition-all duration-75 ease-out shadow-[0_0_12px_rgba(34,211,238,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Live percentage & status */}
        <div className="flex justify-between items-center mt-2.5 text-[11px] font-mono text-wa-muted">
          <span className="truncate pr-2">{statusText}</span>
          <span className="text-cyan-400 font-semibold">{progress}%</span>
        </div>
      </div>

      {/* Quick skip prompt */}
      <div className="absolute bottom-8 text-[11px] text-wa-muted/60 tracking-wider font-mono">
        Click anywhere to skip
      </div>
    </div>
  );
}

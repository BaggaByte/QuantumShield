import React, { useState, useEffect } from "react";
import { Volume2, VolumeX, Smartphone, Vibrate, Check, X, Sparkles, Play } from "lucide-react";
import { soundHapticService } from "@/services/SoundHapticService";

interface AudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AudioSettingsModal({ isOpen, onClose }: AudioSettingsModalProps) {
  const [soundEnabled, setSoundEnabled] = useState(soundHapticService.isSoundEnabled());
  const [hapticsEnabled, setHapticsEnabled] = useState(soundHapticService.isHapticsEnabled());
  const [volume, setVolume] = useState(soundHapticService.getVolume());
  const [hasVibrateSupport, setHasVibrateSupport] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      setHasVibrateSupport(true);
    }
    const unsub = soundHapticService.subscribe(() => {
      setSoundEnabled(soundHapticService.isSoundEnabled());
      setHapticsEnabled(soundHapticService.isHapticsEnabled());
      setVolume(soundHapticService.getVolume());
    });
    return unsub;
  }, []);

  if (!isOpen) return null;

  const toggleSound = (val: boolean) => {
    soundHapticService.setSoundEnabled(val);
    setSoundEnabled(val);
    if (val) {
      soundHapticService.play("tap");
      soundHapticService.triggerHaptic("tap");
    }
  };

  const toggleHaptics = (val: boolean) => {
    soundHapticService.setHapticsEnabled(val);
    setHapticsEnabled(val);
    if (val) {
      soundHapticService.triggerHaptic("tap");
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    soundHapticService.setVolume(newVol);
  };

  const testAudio = (type: "send" | "receive" | "handshake") => {
    soundHapticService.play(type);
    soundHapticService.triggerHaptic(type === "receive" ? "receive" : type === "send" ? "send" : "success");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-[#111c24] border border-white/10 shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 bg-[#1f2c34] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-wa-teal/10 border border-wa-teal/30 flex items-center justify-center text-wa-teal">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Audio & Haptic Feedback</h3>
              <p className="text-[11px] font-mono text-wa-muted">Procedural Web Audio & Tactile Engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-wa-muted hover:text-white hover:bg-wa-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5 text-sm">
          {/* Sound Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-medium text-white flex items-center gap-2">
                {soundEnabled ? <Volume2 className="w-4 h-4 text-wa-teal" /> : <VolumeX className="w-4 h-4 text-wa-muted" />}
                <span>Interaction Sounds</span>
              </span>
              <p className="text-xs text-wa-muted">
                Restrained WhatsApp-style outgoing pops, incoming chimes, and ticks
              </p>
            </div>
            <button
              onClick={() => toggleSound(!soundEnabled)}
              className={`w-12 h-6 rounded-full transition-colors relative focus:outline-none p-0.5 ${
                soundEnabled ? "bg-wa-teal" : "bg-white/10"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  soundEnabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Volume Slider (if sound enabled) */}
          {soundEnabled && (
            <div className="space-y-2 pt-1 border-t border-white/5">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-wa-muted">Volume Level</span>
                <span className="text-wa-teal font-semibold">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#2a3942] rounded-lg appearance-none cursor-pointer accent-wa-teal"
              />
            </div>
          )}

          {/* Haptics Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <div className="space-y-0.5">
              <span className="font-medium text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span>Tactile Mobile Haptics</span>
              </span>
              <p className="text-xs text-wa-muted">
                Subtle vibration pulses on button taps and received messages
              </p>
              {!hasVibrateSupport && (
                <span className="text-[10px] text-amber-400/80 font-mono block">
                  (Device does not report navigator.vibrate support)
                </span>
              )}
            </div>
            <button
              onClick={() => toggleHaptics(!hapticsEnabled)}
              className={`w-12 h-6 rounded-full transition-colors relative focus:outline-none p-0.5 ${
                hapticsEnabled ? "bg-cyan-500" : "bg-white/10"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white transition-transform ${
                  hapticsEnabled ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Interactive Sound Preview Grid */}
          <div className="pt-3 border-t border-white/5 space-y-2">
            <span className="text-xs font-mono text-wa-muted uppercase tracking-wider block">
              Audio Previews
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => testAudio("send")}
                className="px-3 py-2 rounded-xl bg-wa-card hover:bg-wa-hover border border-white/5 text-xs text-white flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Play className="w-3 h-3 text-wa-teal" />
                <span>Send Pop</span>
              </button>
              <button
                onClick={() => testAudio("receive")}
                className="px-3 py-2 rounded-xl bg-wa-card hover:bg-wa-hover border border-white/5 text-xs text-white flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Play className="w-3 h-3 text-cyan-400" />
                <span>Chime</span>
              </button>
              <button
                onClick={() => testAudio("handshake")}
                className="px-3 py-2 rounded-xl bg-wa-card hover:bg-wa-hover border border-white/5 text-xs text-white flex items-center justify-center gap-1.5 transition-all active:scale-95"
              >
                <Sparkles className="w-3 h-3 text-emerald-400" />
                <span>Shimmer</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-[#1f2c34] border-t border-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-wa-teal hover:bg-[#00c298] text-white text-xs font-semibold transition-all active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * QuantumShield - UI Sound Design & Haptic Feedback Engine
 * Procedural Web Audio API sound synthesis and mobile tactile feedback.
 * 
 * Features:
 * - Zero external assets or network requests (100% procedural synthesis in browser RAM)
 * - WhatsApp-inspired signature frequencies (outgoing pop, incoming chime, delivery tick)
 * - Restrained, non-intrusive sound profiles
 * - Native mobile haptic patterns via Navigator.vibrate
 * - Full user controls (sound on/off, haptics on/off, volume slider)
 * - Graceful fallbacks when audio or vibration APIs are restricted
 */

export type SoundType = 'send' | 'receive' | 'delivered' | 'handshake' | 'tap' | 'error' | 'burn';
export type HapticType = 'tap' | 'send' | 'receive' | 'success' | 'error' | 'burn';

class SoundHapticService {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;
  private hapticsEnabled: boolean = true;
  private volume: number = 0.7; // 0.0 to 1.0

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedSound = localStorage.getItem('qs_sound_enabled');
        if (storedSound !== null) this.soundEnabled = storedSound === 'true';

        const storedHaptics = localStorage.getItem('qs_haptics_enabled');
        if (storedHaptics !== null) this.hapticsEnabled = storedHaptics === 'true';

        const storedVolume = localStorage.getItem('qs_sound_volume');
        if (storedVolume !== null) this.volume = parseFloat(storedVolume);
      } catch {
        // Fallback for sandboxed iframes
      }

      // Pre-warm AudioContext on user first interaction
      const unlockAudio = () => {
        this.getAudioContext();
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
      };
      window.addEventListener('pointerdown', unlockAudio, { passive: true });
      window.addEventListener('keydown', unlockAudio, { passive: true });
    }
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  // --- Haptic Feedback --------------------------------------------------------

  public triggerHaptic(type: HapticType = 'tap') {
    if (!this.hapticsEnabled || typeof window === 'undefined') return;
    if (!('vibrate' in navigator) || typeof navigator.vibrate !== 'function') return;

    try {
      switch (type) {
        case 'tap':
          navigator.vibrate(8);
          break;
        case 'send':
          navigator.vibrate(15);
          break;
        case 'receive':
          navigator.vibrate([15, 35, 20]);
          break;
        case 'success':
          navigator.vibrate([10, 30, 15]);
          break;
        case 'error':
          navigator.vibrate([25, 40, 30]);
          break;
        case 'burn':
          navigator.vibrate([10, 25, 10]);
          break;
      }
    } catch {
      // Ignore vibration errors on unsupported devices
    }
  }

  // --- Procedural Sound Synthesis --------------------------------------------

  public play(type: SoundType) {
    if (!this.soundEnabled || this.volume <= 0) return;

    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.volume, now);
      masterGain.connect(ctx.destination);

      switch (type) {
        // WhatsApp-inspired Outgoing Pop (Ascending chirp with rapid decay)
        case 'send': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(750, now);
          osc.frequency.exponentialRampToValueAtTime(1300, now + 0.04);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.12, now + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now);
          osc.stop(now + 0.06);
          break;
        }

        // WhatsApp-inspired Incoming Message Chime (Two-tone warm harmonic)
        case 'receive': {
          const playTone = (freq: number, startOffset: number, duration: number, peakGain: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + startOffset);

            gain.gain.setValueAtTime(0.001, now + startOffset);
            gain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);

            osc.connect(gain);
            gain.connect(masterGain);

            osc.start(now + startOffset);
            osc.stop(now + startOffset + duration);
          };

          // Tone 1: C6 (1046.5 Hz)
          playTone(1046.5, 0.0, 0.08, 0.09);
          // Tone 2: E6 (1318.5 Hz)
          playTone(1318.5, 0.045, 0.12, 0.11);
          break;
        }

        // Delivery receipt acknowledgment tick (Very subtle high click)
        case 'delivered': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(1800, now);
          osc.frequency.exponentialRampToValueAtTime(2200, now + 0.015);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.04, now + 0.002);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now);
          osc.stop(now + 0.02);
          break;
        }

        // Post-Quantum Handshake Complete Shimmer (Harmonic Major Triad)
        case 'handshake': {
          const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
          freqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.02);

            gain.gain.setValueAtTime(0.001, now + idx * 0.02);
            gain.gain.linearRampToValueAtTime(0.05, now + idx * 0.02 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.02 + 0.22);

            osc.connect(gain);
            gain.connect(masterGain);

            osc.start(now + idx * 0.02);
            osc.stop(now + idx * 0.02 + 0.25);
          });
          break;
        }

        // UI Button Tap / Interaction (Muted acoustic thud)
        case 'tap': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(400, now);
          osc.frequency.exponentialRampToValueAtTime(180, now + 0.02);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.04, now + 0.003);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now);
          osc.stop(now + 0.03);
          break;
        }

        // Error / Alert feedback (Soft descending minor alert)
        case 'error': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(380, now);
          osc.frequency.linearRampToValueAtTime(220, now + 0.12);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }

        // Ephemeral Message Evaporation (Soft descending whisper whoosh)
        case 'burn': {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(650, now);
          osc.frequency.exponentialRampToValueAtTime(110, now + 0.2);

          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(now);
          osc.stop(now + 0.24);
          break;
        }
      }
    } catch {
      // Audio playback fails gracefully without throwing
    }
  }

  // --- Settings & Persistence ------------------------------------------------

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public setSoundEnabled(val: boolean) {
    this.soundEnabled = val;
    try {
      localStorage.setItem('qs_sound_enabled', String(val));
    } catch {}
    this.notifyChange();
  }

  public isHapticsEnabled(): boolean {
    return this.hapticsEnabled;
  }

  public setHapticsEnabled(val: boolean) {
    this.hapticsEnabled = val;
    try {
      localStorage.setItem('qs_haptics_enabled', String(val));
    } catch {}
    this.notifyChange();
  }

  public getVolume(): number {
    return this.volume;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    try {
      localStorage.setItem('qs_sound_volume', String(this.volume));
    } catch {}
    this.notifyChange();
  }

  // Optional listener for reactive UI bindings
  private listeners: Set<() => void> = new Set();

  public subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notifyChange() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch {}
    });
  }
}

export const soundHapticService = new SoundHapticService();

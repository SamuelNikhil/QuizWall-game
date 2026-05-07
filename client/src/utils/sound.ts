// ==========================================
// Sound Manager — Cross-platform Audio
// Supports iOS (Web Audio API) and Android (HTMLAudio + Web Audio)
// All gameplay audio is controller-only.
// ==========================================

import correctSoundUrl from '../assets/sounds/correct.mp3';
import wrongSoundUrl from '../assets/sounds/wrong.mp3';

// ---- Platform detection ----
function isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

function isAndroid(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent);
}

// ---- Haptic helpers ----
// Standard Vibration API (Android, some desktop)
function vibrateNative(pattern: number | number[]): boolean {
    try {
        if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
            return navigator.vibrate(pattern);
        }
    } catch {
        // ignore
    }
    return false;
}

export class SoundManager {
    private audioContext: AudioContext | null = null;
    private enabled: boolean = true;
    // Tracks whether the AudioContext has been unlocked by a user gesture
    private unlocked: boolean = false;
    // Pre-decoded buffers for low-latency playback
    private buffers: Record<string, AudioBuffer> = {};
    // HTMLAudio elements as a fallback for Android (avoids decode overhead)
    private htmlAudio: Record<string, HTMLAudioElement> = {};
    // Whether we are on the controller route
    private _isController: boolean | null = null;

    // ---- Route guard ----
    private isControllerRoute(): boolean {
        if (this._isController !== null) return this._isController;
        if (typeof window === 'undefined') return false;
        const p = window.location.pathname.toLowerCase();
        this._isController = p === '/controller' || p.startsWith('/controller/');
        return this._isController;
    }

    private canPlay(): boolean {
        return this.enabled && this.isControllerRoute();
    }

    // ---- AudioContext ----
    private getContext(): AudioContext {
        if (!this.audioContext) {
            const Ctor =
                (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
                    .AudioContext ??
                (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) throw new Error('Web Audio API not supported');
            this.audioContext = new Ctor();
        }
        return this.audioContext;
    }

    // ---- Unlock (must be called from a user-gesture handler) ----
    /**
     * Unlocks the AudioContext and pre-loads sound buffers.
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    async unlock(): Promise<void> {
        if (!this.isControllerRoute()) return;
        if (this.unlocked) return;

        try {
            const ctx = this.getContext();

            // Resume suspended context (required on iOS Safari)
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            // Play a silent 1-sample buffer — fully unlocks iOS audio
            const silentBuf = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = silentBuf;
            src.connect(ctx.destination);
            src.start(0);

            // Load sounds in parallel
            await Promise.all([
                this._loadBuffer('correct', correctSoundUrl),
                this._loadBuffer('wrong', wrongSoundUrl),
            ]);

            // Also prime HTMLAudio elements for Android (lower latency on first play)
            if (isAndroid()) {
                this._primeHtmlAudio('correct', correctSoundUrl);
                this._primeHtmlAudio('wrong', wrongSoundUrl);
            }

            this.unlocked = true;
            console.log('[Sound] Unlocked. iOS:', isIOS(), 'Android:', isAndroid());
        } catch (e) {
            console.warn('[Sound] Unlock failed:', e);
        }
    }

    // ---- Buffer loading ----
    private async _loadBuffer(name: string, url: string): Promise<void> {
        try {
            const ctx = this.getContext();
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            // Older Safari doesn't return a Promise from decodeAudioData
            const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
                ctx.decodeAudioData(arrayBuffer, resolve, reject);
            });
            this.buffers[name] = audioBuffer;
        } catch (e) {
            console.warn(`[Sound] Failed to load buffer "${name}":`, e);
        }
    }

    // ---- HTMLAudio priming (Android) ----
    private _primeHtmlAudio(name: string, url: string): void {
        try {
            const el = new Audio(url);
            el.preload = 'auto';
            el.volume = 0;
            // Trigger a silent play to prime the audio pipeline
            const p = el.play();
            if (p) p.then(() => el.pause()).catch(() => {});
            el.volume = 1;
            this.htmlAudio[name] = el;
        } catch {
            // ignore
        }
    }

    // ---- Core playback ----
    private async _playBuffer(name: string, volume = 1.0): Promise<void> {
        if (!this.canPlay()) return;

        const buffer = this.buffers[name];
        if (!buffer) return;

        try {
            const ctx = this.getContext();
            if (ctx.state === 'suspended') await ctx.resume();

            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            source.buffer = buffer;
            source.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = volume;
            source.start(0);
        } catch (e) {
            // Fallback to HTMLAudio on Web Audio failure
            this._playHtmlAudio(name, volume);
            console.warn(`[Sound] Web Audio playback failed for "${name}", using HTMLAudio:`, e);
        }
    }

    private _playHtmlAudio(name: string, volume = 1.0): void {
        try {
            const el = this.htmlAudio[name];
            if (!el) return;
            el.volume = Math.max(0, Math.min(1, volume));
            el.currentTime = 0;
            el.play().catch(() => {});
        } catch {
            // ignore
        }
    }

    // ---- Tone synthesis ----
    private async _playTone(
        frequency: number,
        duration: number,
        type: OscillatorType = 'sine',
        volume = 0.3
    ): Promise<void> {
        if (!this.canPlay()) return;
        try {
            const ctx = this.getContext();
            if (ctx.state === 'suspended') await ctx.resume();

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = type;
            osc.frequency.setValueAtTime(frequency, ctx.currentTime);
            gain.gain.setValueAtTime(volume, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('[Sound] Tone error:', e);
        }
    }

    // ---- Haptics ----
    /**
     * Triggers haptic feedback.
     * - Android: uses Vibration API
     * - iOS: plays a sub-bass tone to engage the Taptic Engine
     */
    vibrate(pattern: number | number[]): void {
        if (!this.canPlay()) return;

        // Android / desktop — standard Vibration API
        if (!isIOS()) {
            vibrateNative(pattern);
            return;
        }

        // iOS — sub-bass audio to trigger Taptic Engine
        const arr = Array.isArray(pattern) ? pattern : [pattern];
        let delay = 0;
        for (let i = 0; i < arr.length; i++) {
            if (i % 2 === 0) {
                // vibrate segment
                const durationSec = arr[i] / 1000;
                const d = delay;
                setTimeout(() => {
                    // 40 Hz square wave — strong physical sensation on iPhone speakers
                    this._playTone(40, durationSec, 'square', 0.9);
                }, d);
            }
            delay += arr[i];
        }
    }

    // ---- Public sound API ----

    /** Play correct/wrong hit sound */
    playHit(correct: boolean): void {
        if (correct) {
            this._playBuffer('correct', 0.7);
        } else {
            this._playBuffer('wrong', 0.7);
        }
    }

    /** Slingshot release whoosh */
    playShoot(): void {
        this._playTone(440, 0.1, 'triangle', 0.3);
        setTimeout(() => this._playTone(660, 0.08, 'triangle', 0.2), 50);
    }

    /** Subtle aim feedback */
    playAim(): void {
        this._playTone(300, 0.05, 'sine', 0.1);
    }

    /** Generic UI beep */
    playBeep(): void {
        this._playTone(600, 0.08, 'sine', 0.2);
    }

    /** Countdown tick */
    playCountdownBeep(): void {
        this._playTone(800, 0.1, 'sine', 0.3);
    }

    /** Transition whoosh (rising sweep) */
    playTransitionWhoosh(): void {
        if (!this.canPlay()) return;
        try {
            const ctx = this.getContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(200, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        } catch (e) {
            console.warn('[Sound] Whoosh error:', e);
        }
    }

    /** Game start fanfare */
    playGameStart(): void {
        this._playTone(523.25, 0.15, 'triangle', 0.4);
        setTimeout(() => this._playTone(659.25, 0.15, 'triangle', 0.4), 100);
        setTimeout(() => this._playTone(783.99, 0.2, 'triangle', 0.4), 200);
    }

    /** Shuffle / card flip sound */
    playShuffle(): void {
        this._playTone(350, 0.06, 'triangle', 0.25);
        setTimeout(() => this._playTone(420, 0.06, 'triangle', 0.2), 60);
    }

    // ---- Toggle ----
    toggle(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    isUnlocked(): boolean {
        return this.unlocked;
    }
}

export const soundManager = new SoundManager();

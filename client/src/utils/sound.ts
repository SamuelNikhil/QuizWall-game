// ==========================================
// Sound Manager — Utilities
// ==========================================

import correctSoundUrl from '../assets/sounds/correct.mp3';
import wrongSoundUrl from '../assets/sounds/wrong.mp3';

export class SoundManager {
    private audioContext: AudioContext | null = null;
    private enabled: boolean = true;
    private initialized: boolean = false;
    private buffers: Record<string, AudioBuffer> = {};

    // Keep all gameplay audio on controller clients only.
    private isControllerRoute(): boolean {
        if (typeof window === 'undefined') return false;
        const pathname = window.location.pathname.toLowerCase();
        return pathname === '/controller' || pathname.startsWith('/controller/');
    }

    private canPlay(): boolean {
        return this.enabled && this.isControllerRoute();
    }

    private getContext(): AudioContext {
        if (!this.audioContext) {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass();
        }
        return this.audioContext!;
    }

    /**
     * Unlocks audio on iOS/Safari. Should be called on first user gesture.
     */
    async unlock(): Promise<void> {
        if (!this.isControllerRoute()) return;
        if (this.initialized) return;
        
        const ctx = this.getContext();
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
        
        // Play a silent buffer to fully unlock
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        
        // Load sound files
        this.loadSound('correct', correctSoundUrl);
        this.loadSound('wrong', wrongSoundUrl);
        
        this.initialized = true;
        console.log('[Sound] AudioContext unlocked');
    }

    private async loadSound(name: string, url: string): Promise<void> {
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const ctx = this.getContext();
            
            // Accommodate older Safari versions that don't return a Promise for decodeAudioData
            const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
                ctx.decodeAudioData(arrayBuffer, resolve, reject);
            });
            
            this.buffers[name] = audioBuffer;
        } catch (e) {
            console.warn(`[Sound] Failed to load sound ${name}:`, e);
        }
    }

    private async playBuffer(name: string, volume: number = 1.0): Promise<void> {
        if (!this.canPlay()) return;
        const buffer = this.buffers[name];
        if (!buffer) return;

        try {
            const ctx = this.getContext();
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const source = ctx.createBufferSource();
            const gainNode = ctx.createGain();

            source.buffer = buffer;
            source.connect(gainNode);
            gainNode.connect(ctx.destination);

            gainNode.gain.value = volume;
            source.start(0);
        } catch (e) {
            console.warn(`[Sound] Error playing ${name}:`, e);
        }
    }

    vibrate(pattern: number | number[]): void {
        if (!this.canPlay()) return;
        
        // 1. Try standard vibration API first (Android/Desktop)
        try {
            if ('vibrate' in navigator && typeof navigator.vibrate === 'function') {
                navigator.vibrate(pattern);
                return; // Supported and executed, we're done.
            }
        } catch (e) {
            // Silently ignore
        }

        // 2. iOS Safari Workaround (Pseudo-haptics via sub-bass audio)
        // Check if we are likely on an Apple mobile device where vibrate failed
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        
        if (isIOS) {
            // Convert standard pattern to an array
            const patternArray = Array.isArray(pattern) ? pattern : [pattern];
            
            // Play a very low frequency tone (sub-bass) to trigger the Taptic Engine implicitly
            // This won't feel exactly like a native vibration, but it provides physical/auditory feedback
            let delay = 0;
            for (let i = 0; i < patternArray.length; i++) {
                // Even indices are vibrate, odd indices are pause
                if (i % 2 === 0) {
                    const durationInSeconds = patternArray[i] / 1000;
                    setTimeout(() => {
                        this.playTone(50, durationInSeconds, 'square', 1.0); // 50Hz is very low, strong amplitude
                    }, delay);
                }
                delay += patternArray[i];
            }
        }
    }

    toggle(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    private async playTone(
        frequency: number,
        duration: number,
        type: OscillatorType = 'sine',
        volume: number = 0.3
    ): Promise<void> {
        if (!this.canPlay()) return;

        try {
            const ctx = this.getContext();
            
            // Auto-resume if suspended (might happen even after unlock on some browsers)
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

            gainNode.gain.setValueAtTime(volume, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + duration);
        } catch (e) {
            console.warn('Sound error:', e);
        }
    }

    playHit(correct: boolean): void {
        if (correct) {
            this.playBuffer('correct', 0.6);
        } else {
            this.playBuffer('wrong', 0.6);
        }
    }

    playShoot(): void {
        this.playTone(440, 0.1, 'triangle', 0.3);
        setTimeout(() => this.playTone(660, 0.08, 'triangle', 0.2), 50);
    }

    playAim(): void {
        this.playTone(300, 0.05, 'sine', 0.1);
    }

    playBeep(): void {
        this.playTone(600, 0.08, 'sine', 0.2);
    }

    playCountdownBeep(): void {
        this.playTone(800, 0.1, 'sine', 0.3);
    }

    playTransitionWhoosh(): void {
        if (!this.canPlay()) return;

        try {
            const ctx = this.getContext();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            
            oscillator.frequency.setValueAtTime(200, ctx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
            
            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.5);
        } catch (e) {
            console.warn('Sound error:', e);
        }
    }

    playGameStart(): void {
        this.playTone(523.25, 0.15, 'triangle', 0.4);
        setTimeout(() => this.playTone(659.25, 0.15, 'triangle', 0.4), 100);
        setTimeout(() => this.playTone(783.99, 0.2, 'triangle', 0.4), 200);
    }
}

export const soundManager = new SoundManager();

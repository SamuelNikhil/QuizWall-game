// ==========================================
// Sound Manager — Utilities
// ==========================================

export class SoundManager {
    private audioContext: AudioContext | null = null;
    private enabled: boolean = true;

    private getContext(): AudioContext {
        if (!this.audioContext) {
            this.audioContext = new AudioContext();
        }
        return this.audioContext;
    }

    toggle(): boolean {
        this.enabled = !this.enabled;
        return this.enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    private playTone(
        frequency: number,
        duration: number,
        type: OscillatorType = 'sine',
        volume: number = 0.3
    ): void {
        if (!this.enabled) return;

        try {
            const ctx = this.getContext();
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
            this.playTone(880, 0.15, 'sine', 0.4);
            setTimeout(() => this.playTone(1100, 0.2, 'sine', 0.3), 100);
        } else {
            this.playTone(200, 0.3, 'sawtooth', 0.2);
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
}

export const soundManager = new SoundManager();

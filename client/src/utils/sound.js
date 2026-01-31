// Sound utility for the Slingshot game
class SoundManager {
  constructor() {
    this.audioContext = null;
    this.sounds = {};
    this.enabled = true;
  }

  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // Create a simple beep sound
  createBeep(frequency, duration, volume = 0.5) {
    if (!this.audioContext || !this.enabled) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  // Create a simple tone
  createTone(frequency, duration, volume = 0.3) {
    if (!this.audioContext || !this.enabled) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  // Play hit sound
  playHit(correct) {
    this.init();
    if (correct) {
      // Upward scale for correct answer
      this.createBeep(523.25, 0.1, 0.7); // C5
      setTimeout(() => this.createBeep(659.25, 0.15, 0.7), 100); // E5
      setTimeout(() => this.createBeep(783.99, 0.2, 0.7), 250); // G5
    } else {
      // Downward tone for wrong answer
      this.createBeep(220, 0.3, 0.5); // A3
    }
  }

  // Play shoot sound
  playShoot() {
    this.init();
    // Slingshot release sound
    this.createTone(150, 0.15, 0.6);
    setTimeout(() => this.createTone(300, 0.1, 0.4), 50);
  }

  // Play aiming sound
  playAim() {
    this.init();
    // Soft beep when starting to aim
    this.createBeep(440, 0.05, 0.3); // A4
  }

  // Toggle sound on/off
  toggleSound() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
}

export default new SoundManager();

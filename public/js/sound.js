// Sound utility using Web Audio API to play programmatically synthesized sounds without needing external assets.
class SoundManager {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // Synthesizes a clean "ding" (service bell) sound
  playBell() {
    try {
      this.init();
      
      // Resume AudioContext if suspended (browser security autoplays)
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      
      // Tone 1: High crisp ding
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1200, now); // Primary frequency
      
      // Decay envelope
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      
      // Tone 2: Warm harmonic overtone
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1500, now); // Overtone
      
      gain2.gain.setValueAtTime(0.15, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);

      // Start and Stop
      osc1.start(now);
      osc1.stop(now + 1.2);
      
      osc2.start(now);
      osc2.stop(now + 0.8);
    } catch (e) {
      console.warn('Web Audio API not supported or blocked by user interaction policy.', e);
    }
  }
}

const Sound = new SoundManager();
// Export to window object if not running in module context
window.Sound = Sound;

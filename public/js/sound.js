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

  // Synthesizes a loud, distinctive multi-tone order alarm sequence for Owners
  playOrderAlarm() {
    try {
      this.init();
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      const notes = [
        { freq: 880, start: 0, duration: 0.15 },
        { freq: 1174.66, start: 0.18, duration: 0.18 },
        { freq: 1396.91, start: 0.38, duration: 0.25 },
        { freq: 1760, start: 0.65, duration: 0.6 }
      ];

      notes.forEach(note => {
        const now = this.ctx.currentTime + note.start;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(note.freq, now);
        
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.duration);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + note.duration);
      });
    } catch (e) {
      console.warn('Web Audio API playOrderAlarm error:', e);
    }
  }
}

const Sound = new SoundManager();
// Export to window object if not running in module context
window.Sound = Sound;

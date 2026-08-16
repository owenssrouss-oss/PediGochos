// Sound utility using Web Audio API to play programmatically synthesized sounds without needing external assets.
class SoundManager {
  constructor() {
    this.ctx = null;
    this.compressor = null;
    this.isPlayingAlarm = false;
    this.alarmInterval = null;
    this.alarmTimeout = null;
    this.lastStartedAt = 0;
    this.activeOscillators = [];
    this.onAlarmStartListeners = [];
    this.onAlarmStopListeners = [];
  }

  init() {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          try {
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
            this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
            this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
            this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
            this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
            this.compressor.connect(this.ctx.destination);
          } catch(e) {
            this.compressor = null;
          }
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch(e) {
      console.warn('AudioContext init notice:', e);
    }
  }

  getDestination() {
    return this.compressor || (this.ctx ? this.ctx.destination : null);
  }

  onAlarmStart(cb) {
    if (typeof cb === 'function') this.onAlarmStartListeners.push(cb);
  }

  onAlarmStop(cb) {
    if (typeof cb === 'function') this.onAlarmStopListeners.push(cb);
  }

  // Synthesizes an ultra-loud, piercing, scandalous kitchen alert burst
  playLoudAlarmBurst() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const dest = this.getDestination();
      if (!dest) return;
      const now = this.ctx.currentTime;

      // 4 Rapid, penetrating beeps/alarm pulses (Strobe Buzzer)
      const pulses = [
        { start: 0.00, duration: 0.14, freq: 1100, highFreq: 2200 },
        { start: 0.18, duration: 0.14, freq: 1400, highFreq: 2800 },
        { start: 0.36, duration: 0.14, freq: 1750, highFreq: 3500 },
        { start: 0.54, duration: 0.30, freq: 2100, highFreq: 4200 }
      ];

      pulses.forEach(p => {
        const pulseStart = now + p.start;
        const pulseEnd = pulseStart + p.duration;

        // Primary piercing tone (Square wave for maximum penetration)
        const oscSquare = this.ctx.createOscillator();
        const gainSquare = this.ctx.createGain();
        oscSquare.type = 'square';
        oscSquare.frequency.setValueAtTime(p.freq, pulseStart);
        oscSquare.frequency.exponentialRampToValueAtTime(p.freq * 1.15, pulseEnd);

        gainSquare.gain.setValueAtTime(0.001, pulseStart);
        gainSquare.gain.linearRampToValueAtTime(0.60, pulseStart + 0.02);
        gainSquare.gain.exponentialRampToValueAtTime(0.001, pulseEnd);

        oscSquare.connect(gainSquare);
        gainSquare.connect(dest);

        oscSquare.start(pulseStart);
        oscSquare.stop(pulseEnd);
        this.activeOscillators.push(oscSquare);

        // Secondary rich harmonic tone (Sawtooth wave)
        const oscSaw = this.ctx.createOscillator();
        const gainSaw = this.ctx.createGain();
        oscSaw.type = 'sawtooth';
        oscSaw.frequency.setValueAtTime(p.highFreq, pulseStart);

        gainSaw.gain.setValueAtTime(0.001, pulseStart);
        gainSaw.gain.linearRampToValueAtTime(0.40, pulseStart + 0.02);
        gainSaw.gain.exponentialRampToValueAtTime(0.001, pulseEnd);

        oscSaw.connect(gainSaw);
        gainSaw.connect(dest);

        oscSaw.start(pulseStart);
        oscSaw.stop(pulseEnd);
        this.activeOscillators.push(oscSaw);
      });

      // Cleanup finished oscillator references
      setTimeout(() => {
        this.activeOscillators = this.activeOscillators.filter(o => {
          try { return o.playbackState !== 3; } catch(e) { return false; }
        });
      }, 1500);

      // Trigger mobile vibration if available
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate([140, 40, 140, 40, 140, 40, 300]);
        } catch(e) {}
      }
    } catch(e) {
      console.warn('Error in playLoudAlarmBurst:', e);
    }
  }

  // Starts a continuous, scandalous 20-second alarm loop until user acknowledges / opens app
  startPersistentOrderAlarm(durationSeconds = 20) {
    try {
      this.init();
      this.lastStartedAt = Date.now();

      // Clear any prior interval/timeout cleanly
      if (this.alarmInterval) {
        clearInterval(this.alarmInterval);
        this.alarmInterval = null;
      }
      if (this.alarmTimeout) {
        clearTimeout(this.alarmTimeout);
        this.alarmTimeout = null;
      }

      this.isPlayingAlarm = true;

      // Play first burst immediately
      this.playLoudAlarmBurst();

      // Repeat burst every 1.15 seconds
      this.alarmInterval = setInterval(() => {
        if (this.isPlayingAlarm) {
          this.playLoudAlarmBurst();
        } else {
          clearInterval(this.alarmInterval);
          this.alarmInterval = null;
        }
      }, 1150);

      // Stop automatically after durationSeconds
      this.alarmTimeout = setTimeout(() => {
        this.stopAlarm();
      }, durationSeconds * 1000);

      // Notify UI listeners
      this.onAlarmStartListeners.forEach(cb => {
        try { cb(); } catch(e) {}
      });
    } catch(e) {
      console.warn('Error starting persistent order alarm:', e);
    }
  }

  // Toggle alarm state cleanly for testing / manual controls
  toggleAlarm(durationSeconds = 10) {
    if (this.isPlayingAlarm) {
      this.stopAlarm();
    } else {
      this.startPersistentOrderAlarm(durationSeconds);
    }
  }

  // Immediately silences the alarm
  stopAlarm() {
    this.isPlayingAlarm = false;

    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.alarmTimeout) {
      clearTimeout(this.alarmTimeout);
      this.alarmTimeout = null;
    }

    // Stop active oscillators safely
    this.activeOscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch(e) {}
    });
    this.activeOscillators = [];

    // Stop vibration
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(0); } catch(e) {}
    }

    // Notify UI listeners
    this.onAlarmStopListeners.forEach(cb => {
      try { cb(); } catch(e) {}
    });
  }

  // Synthesizes a clean "ding" (service bell) sound
  playBell() {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const dest = this.getDestination() || this.ctx.destination;
      const now = this.ctx.currentTime;
      
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1200, now);
      gain1.gain.setValueAtTime(0.4, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
      osc1.connect(gain1);
      gain1.connect(dest);
      
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1500, now);
      gain2.gain.setValueAtTime(0.2, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc2.connect(gain2);
      gain2.connect(dest);

      osc1.start(now);
      osc1.stop(now + 1.2);
      osc2.start(now);
      osc2.stop(now + 0.8);
    } catch (e) {
      console.warn('Web Audio API playBell error:', e);
    }
  }

  // Synthesizes a loud, distinctive multi-tone order alarm sequence for Owners
  playOrderAlarm() {
    this.startPersistentOrderAlarm(10);
  }
}

const Sound = new SoundManager();
window.Sound = Sound;

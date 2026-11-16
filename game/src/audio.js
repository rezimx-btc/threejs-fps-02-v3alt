// EMBERLINE — every sound is synthesised in WebAudio. No audio assets ship
// with the game: oscillators and filtered noise build every shot, step and
// sting, so the game loads nothing over the network. Hearing is also a
// gameplay system — shots publish noise events the bots hear — and the noise
// log below is the shared list they read, rebuilt every fixed step.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      enabled = true;
      return true;
    } catch {
      return false;
    }
  }

  function playNoise(dur, filterFreq, filterType, gainValue, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + dur + 0.05);
  }

  function playTone(freq, dur, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    get enabled() {
      return enabled;
    },
    // distance in metres: 0 = point blank, 1 = ~40 m away. Volume and the
    // low-pass follow distance so far shots sound far away, not just quiet.
    shot(kind, distance = 0) {
      const d = Math.min(1, Math.max(0, distance));
      const vol = 0.55 * (1 - d * 0.75);
      if (kind === 'rifle') {
        playNoise(0.14, 2400 - d * 1400, 'lowpass', vol);
        playTone(160, 0.12, 'sine', vol * 0.9, 55);
      } else if (kind === 'smg') {
        playNoise(0.09, 3200 - d * 1600, 'lowpass', vol * 0.8);
        playTone(190, 0.08, 'sine', vol * 0.7, 70);
      } else if (kind === 'shotgun') {
        playNoise(0.24, 1600 - d * 900, 'lowpass', vol);
        playTone(110, 0.2, 'sine', vol, 40);
      } else {
        playNoise(0.1, 2800 - d * 1400, 'lowpass', vol * 0.7);
        playTone(200, 0.08, 'sine', vol * 0.6, 80);
      }
    },
    dry() {
      playTone(1400, 0.04, 'square', 0.12);
    },
    reload() {
      playTone(900, 0.05, 'square', 0.1);
      playTone(600, 0.05, 'square', 0.1, 0, 0.18);
      playTone(1100, 0.06, 'square', 0.12, 0, 0.55);
    },
    step(run) {
      playNoise(0.07, 500, 'lowpass', run ? 0.14 : 0.09);
    },
    hit() {
      playTone(2200, 0.05, 'sine', 0.18);
    },
    headshot() {
      playTone(2600, 0.07, 'sine', 0.22);
      playTone(3400, 0.09, 'sine', 0.16, 0, 0.06);
    },
    kill() {
      playTone(880, 0.09, 'triangle', 0.16);
      playTone(1320, 0.12, 'triangle', 0.14, 0, 0.08);
    },
    beep(final = false) {
      playTone(final ? 1760 : 1320, 0.09, 'square', 0.14);
    },
    explosion() {
      playNoise(1.4, 500, 'lowpass', 0.9);
      playTone(70, 1.1, 'sine', 0.8, 28);
      playNoise(0.4, 3000, 'highpass', 0.25);
    },
    flash() {
      playTone(5200, 0.5, 'sine', 0.22, 4800);
    },
    chime() {
      playTone(1046, 0.16, 'triangle', 0.16);
      playTone(1568, 0.22, 'triangle', 0.14, 0, 0.12);
    },
    sting(win) {
      if (win) {
        playTone(523, 0.16, 'triangle', 0.2);
        playTone(659, 0.16, 'triangle', 0.2, 0, 0.14);
        playTone(784, 0.3, 'triangle', 0.22, 0, 0.28);
      } else {
        playTone(392, 0.2, 'triangle', 0.18);
        playTone(311, 0.34, 'triangle', 0.18, 0, 0.18);
      }
    },
    plant() {
      playTone(660, 0.12, 'square', 0.14);
      playTone(660, 0.12, 'square', 0.14, 0, 0.2);
    },
  };
}

// A noise event: what made it, where, how loud (radius in metres). Bots hear
// shots, steps and explosions through this list; it is rebuilt every fixed
// step so it never grows.
export function createNoiseLog() {
  const events = [];
  return {
    events,
    clear() {
      events.length = 0;
    },
    add(kind, x, y, z, radius) {
      events.push({ kind, x, y, z, radius });
    },
  };
}

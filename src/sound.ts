// Synthesized audio: sound effects plus a looping chiptune, no media files.
// Everything is unlocked on the first user gesture and respects the mute toggle.
const MUTE_KEY = "tilcayo.muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function context(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function out(): AudioNode {
  return master ?? (context() as AudioContext).destination;
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.15, slideTo?: number, at?: number): void {
  const ac = context();
  if (!ac) return;
  const t0 = at ?? ac.currentTime;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(out());
  osc.start(t0);
  osc.stop(t0 + duration);
}

export const sfx = {
  unlock(): void {
    context();
  },
  catch(): void {
    tone(520, 0.09, "square", 0.08, 880);
    setTimeout(() => tone(1400, 0.12, "sine", 0.12, 2200), 40);
  },
  squeak(): void {
    tone(1800, 0.08, "triangle", 0.05, 2600);
  },
  miss(): void {
    tone(220, 0.12, "sawtooth", 0.05, 160);
  },
  over(): void {
    tone(440, 0.25, "triangle", 0.12, 220);
    setTimeout(() => tone(330, 0.4, "triangle", 0.12, 110), 200);
  }
};

// ---- music ---------------------------------------------------------------

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

// Two bars of a bouncy pentatonic tune in C major, 16th-note grid. 0 = rest.
const LEAD = [
  72, 0, 76, 0, 79, 0, 76, 72, 74, 0, 72, 0, 69, 0, 0, 0,
  72, 0, 76, 0, 79, 0, 81, 79, 76, 0, 74, 0, 72, 0, 0, 0,
  67, 0, 72, 0, 76, 0, 72, 67, 69, 0, 72, 0, 74, 0, 72, 0,
  71, 0, 74, 0, 79, 0, 74, 71, 72, 0, 0, 0, 0, 0, 0, 0
];
const BASS = [
  48, 0, 0, 0, 55, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0,
  48, 0, 0, 0, 55, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0,
  43, 0, 0, 0, 50, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0,
  47, 0, 0, 0, 55, 0, 0, 0, 48, 0, 0, 0, 55, 0, 0, 0
];
const BPM = 132;
const STEP = 60 / BPM / 4;

let musicTimer = 0;
let step = 0;
let nextTime = 0;
let playing = false;

function hat(at: number): void {
  const ac = context();
  if (!ac) return;
  const len = 0.03;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const amp = ac.createGain();
  amp.gain.value = 0.05;
  src.connect(hp).connect(amp).connect(out());
  src.start(at);
}

function schedule(): void {
  const ac = context();
  if (!ac || !playing) return;
  while (nextTime < ac.currentTime + 0.12) {
    const i = step % LEAD.length;
    const lead = LEAD[i]!;
    const bass = BASS[i]!;
    if (lead) tone(midi(lead), STEP * 0.9, "square", 0.035, undefined, nextTime);
    if (bass) tone(midi(bass), STEP * 3.2, "triangle", 0.07, undefined, nextTime);
    if (i % 4 === 2) hat(nextTime);
    nextTime += STEP;
    step++;
  }
}

export const music = {
  start(): void {
    const ac = context();
    if (!ac || playing) return;
    playing = true;
    step = 0;
    nextTime = ac.currentTime + 0.05;
    musicTimer = window.setInterval(schedule, 50);
    schedule();
  },
  stop(): void {
    playing = false;
    window.clearInterval(musicTimer);
  },
  get playing(): boolean {
    return playing;
  }
};

export const volume = {
  get muted(): boolean {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return muted;
  }
};

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

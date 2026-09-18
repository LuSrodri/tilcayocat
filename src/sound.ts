// Tiny synthesized sound effects: no audio files, unlocked on the first user gesture.
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, duration: number, type: OscillatorType, gain = 0.15, slideTo?: number): void {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + duration);
  amp.gain.setValueAtTime(gain, ac.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
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

// Trailer studio (dev only: open /tools/trailer.html with `npm run dev`).
//
// Renders the trailer frame by frame on a virtual clock, at 4:3 (default), 16:9 (?ar=16x9) or
// 9:16 for Shorts/Reels (?ar=9x16): performance.now, timers and
// requestAnimationFrame are replaced, so the real game (Game + Lawn) runs deterministically and
// every frame is captured, however slow the machine. The game's own synthesized music and sound
// effects are recorded into an OfflineAudioContext on the same clock. Captions, pops and the
// logo are painted over the 3D frame on a 2D canvas. Frames (JPEG) and the soundtrack (WAV) are
// POSTed to a local receiver (?sink=http://localhost:5288) and assembled with ffmpeg.

export {};

const FPS = 30;
const DUR = 46; // seconds
const params = new URLSearchParams(location.search);
const SIZES: Record<string, [number, number]> = { "4x3": [1440, 1080], "16x9": [1920, 1080], "9x16": [1080, 1920] };
const [W, H] = SIZES[params.get("ar") ?? "4x3"] ?? SIZES["4x3"]!;
/** portrait (Shorts): keep words out of the bottom ~22% and the right edge, where the app draws its UI */
const TALL = H > W;
/** ?clean: no captions, HUD, pops or logo, for stills that ad images are built on */
const CLEAN = params.has("clean");
for (const el of document.querySelectorAll<HTMLElement>(".stage, #out")) {
  el.style.width = `${W}px`;
  el.style.height = `${H}px`;
}
const outEl = document.getElementById("out") as HTMLCanvasElement;
outEl.width = W;
outEl.height = H;
const SINK = params.get("sink") ?? "http://localhost:5288";
// ?at=7,12.5 renders up to those seconds, uploads one still each (p-<s>.jpg) and stops
const PREVIEW = params.has("at") ? params.get("at")!.split(",").map(Number).sort((a, b) => a - b) : null;
const statusEl = document.getElementById("status")!;

// ---- deterministic randomness --------------------------------------------------------------
let seed = 20261001;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---- virtual clock -------------------------------------------------------------------------
let vt = 1000;
interface Timer { id: number; at: number; fn: () => void; every: number }
let timers: Timer[] = [];
let nextId = 1;
let rafs = new Map<number, FrameRequestCallback>();
// yield to the browser without timers (hidden tabs throttle setTimeout hard)
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const breathe = (): Promise<void> =>
  new Promise((r) => {
    waiting.push(r);
    channel.port2.postMessage(0);
  });

performance.now = () => vt;
(window as unknown as Record<string, unknown>).setTimeout = (fn: () => void, ms = 0) => {
  const id = nextId++;
  timers.push({ id, at: vt + Math.max(0, ms), fn, every: 0 });
  return id;
};
(window as unknown as Record<string, unknown>).setInterval = (fn: () => void, ms = 0) => {
  const id = nextId++;
  timers.push({ id, at: vt + Math.max(1, ms), fn, every: Math.max(1, ms) });
  return id;
};
window.clearTimeout = window.clearInterval = (id?: number) => {
  timers = timers.filter((t) => t.id !== id);
};
window.requestAnimationFrame = (cb) => {
  const id = nextId++;
  rafs.set(id, cb);
  return id;
};
window.cancelAnimationFrame = (id) => void rafs.delete(id);
(window as unknown as Record<string, unknown>).requestIdleCallback = (fn: () => void) => window.setTimeout(fn, 1);
Object.defineProperty(window, "devicePixelRatio", { get: () => 1 });
try {
  localStorage.setItem("tilcayo.quality", "0");
  localStorage.setItem("tilcayo.muted", "0");
} catch {
  /* ignore */
}

function runTimers(): void {
  for (let guard = 0; guard < 500; guard++) {
    const due = timers.filter((t) => t.at <= vt).sort((a, b) => a.at - b.at)[0];
    if (!due) return;
    if (due.every) due.at += due.every;
    else timers = timers.filter((t) => t !== due);
    due.fn();
  }
}

function step(ms: number): void {
  vt += ms;
  runTimers();
  const cbs = [...rafs.values()];
  rafs = new Map();
  for (const cb of cbs) cb(vt);
}

// ---- offline audio on the same clock --------------------------------------------------------
const SR = 48000;
const offline = new OfflineAudioContext(2, SR * DUR, SR);
let recording = false;
let audioT0 = 0;
const audioNow = (): number => Math.max(0, (vt - audioT0) / 1000);
function gate<T extends AudioScheduledSourceNode>(node: T): T {
  const start = node.start.bind(node);
  const stop = node.stop.bind(node);
  let started = false;
  node.start = (when?: number) => {
    if (!recording) return;
    started = true;
    start(when ?? audioNow());
  };
  node.stop = (when?: number) => {
    if (started) stop(when ?? audioNow());
  };
  return node;
}
const audioProxy = new Proxy(offline, {
  get(target, prop) {
    if (prop === "currentTime") return audioNow();
    if (prop === "state") return "running";
    if (prop === "resume") return () => Promise.resolve();
    if (prop === "createOscillator") return () => gate(target.createOscillator());
    if (prop === "createBufferSource") return () => gate(target.createBufferSource());
    const v = Reflect.get(target, prop, target) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  }
});
(window as unknown as Record<string, unknown>).AudioContext = function AudioContext() {
  return audioProxy;
};

// ---- the game, imported only now that the clock is patched -----------------------------------
const THREE = await import("three");
const { Lawn } = await import("../src/engine/lawn");
const { Game } = await import("../src/game");
const { sfx, music } = await import("../src/sound");
const { dailyVariant, fancyKind } = await import("../src/fancy");
type LawnT = InstanceType<typeof Lawn>;

const font = new FontFace("Fredoka", "url(/art-src/fonts/Fredoka-Bold.ttf)", { weight: "700" });
await font.load();
document.fonts.add(font);
const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
const logo = await loadImg("/brand/logo-wordmark.png");

const insets = () => (TALL ? { top: 330, bottom: 560, left: 30, right: 30 } : { top: 70, bottom: 170, left: 40, right: 40 });
const lawn = new Lawn({ container: document.getElementById("stage1")!, cats: 1, insets });
const duel = new Lawn({
  container: document.getElementById("stage2")!,
  cats: 2,
  insets: () => (TALL ? { top: 420, bottom: 560, left: 20, right: 20 } : { top: 120, bottom: 170, left: 30, right: 30 })
});
for (const l of [lawn, duel] as unknown as Record<string, unknown>[]) {
  l.watchFrameRate = () => {};
  l.quality = 0;
  (l.applyQuality as (live: boolean) => void).call(l, true);
}
duel.setCatSkin(1, "calico");
duel.setCatSkin(2, "tilcayo");

// pops are DOM elements in the game; here they are recorded and painted on the frame
interface Pop { x: number; y: number; text: string; kind: string; at: number; duel: boolean }
const pops: Pop[] = [];
function hookPops(l: LawnT): void {
  (l as unknown as { pop: (h: number, t: string, k?: string) => void }).pop = (hole, text, kind = "") => {
    if (!text) return;
    const s = l.holeScreen(hole);
    pops.push({ x: s.x, y: s.y - s.size * 0.75, text, kind, at: vt, duel: l === duel });
  };
}
hookPops(lawn);
hookPops(duel);

// camera override: frame a point instead of the open holes
let cam: { target: InstanceType<typeof THREE.Vector3>; dist: number } | null = null;
const lawnAny = lawn as unknown as Record<string, unknown> & { fit: () => void; fitDirty: boolean; wantTarget: InstanceType<typeof THREE.Vector3>; wantDist: number };
const origFit = lawnAny.fit.bind(lawn);
lawnAny.fit = function (): void {
  if (cam) {
    lawnAny.fitDirty = false;
    lawnAny.wantTarget.copy(cam.target);
    lawnAny.wantDist = cam.dist;
  } else origFit();
};
function setCam(c: typeof cam): void {
  cam = c;
  lawnAny.fitDirty = true;
}

statusEl.textContent = "building lawns…";
let built = false;
void Promise.all([lawn.ready, duel.ready]).then(() => (built = true));
while (!built) {
  step(16);
  await breathe();
}
duel.setActive(Array.from({ length: 25 }, (_, i) => i), false);

// ---- the solo game with a callout layer -----------------------------------------------------
interface Callout { text: string; at: number; color: string }
const callouts: Callout[] = [];
const CALLS: Record<number, string> = { 5: "Nice combo!", 10: "Purrfect!", 15: "Unstoppable!", 20: "Feline frenzy!", 30: "LEGENDARY!" };
let lizardCaught = 0;
const game = new Game(
  lawn,
  {
    onScore() {},
    onTimer() {},
    onPower() {},
    onLawn() {},
    onNewHole() {},
    onLick() {
      callouts.push({ text: "Ouch! Lick lick…", at: vt, color: "#ff9a6a" });
    },
    onGameOver() {},
    onCombo(combo) {
      if (CALLS[combo]) {
        callouts.push({ text: CALLS[combo]!, at: vt, color: "#ffd66b" });
        sfx.combo(Math.floor(combo / 5));
      }
    },
    onFancy(variant, count) {
      callouts.push({ text: fancyKind(variant).name, at: vt, color: "#ffd66b" });
    },
    onEvent(ev) {
      if (ev.type === "catch" && ev.lizard) lizardCaught += 1;
    }
  },
  { lizard: () => true, dailyDone: () => false }
);
const g = game as unknown as {
  holes: { up: boolean; what: string; upAt: number; open: boolean }[];
  tap(i: number): void;
  spawn(now: number, what: string, variant?: number | null): void;
  score: number;
  power: string | null;
  stunUntil: number;
  deadline: number;
  nextFoeAt: number;
  nextSnakeAt: number;
  nextPowerAt: number;
  nextLizardAt: number;
  plainSinceFancy: number;
  running: boolean;
};

// the autoplayer: a quick but human paw
let T = -1; // trailer time in seconds (negative during the pre-roll)
let nextTapAt = 0;
const reaction = new Map<string, number>();
const forced: { at: number; hole: () => number }[] = [];
function autoplay(): void {
  if (!g.running || vt < nextTapAt || vt < g.stunUntil) return;
  const f = forced.find((x) => T >= x.at);
  if (f) {
    const hole = f.hole();
    forced.splice(forced.indexOf(f), 1);
    if (hole >= 0) {
      g.tap(hole);
      nextTapAt = vt + 260;
      return;
    }
  }
  const freezeOn = g.power === "freeze";
  let best = -1;
  let bestAt = Infinity;
  g.holes.forEach((h, i) => {
    if (!h.up) return;
    const prey = h.what === "mouse" || h.what === "lizard" || (h.what === "fancy" && T > 13.4);
    if (!prey) return;
    const key = `${i}:${h.upAt}`;
    if (!reaction.has(key)) reaction.set(key, h.what === "lizard" ? 560 + Math.random() * 120 : (freezeOn ? 420 : 200) + Math.random() * (freezeOn ? 380 : 240));
    const ready = h.upAt + reaction.get(key)!;
    if (vt >= ready && ready < bestAt) {
      bestAt = ready;
      best = i;
    }
  });
  if (best >= 0) {
    g.tap(best);
    nextTapAt = vt + (freezeOn ? 330 : 120) + Math.random() * 90;
  }
}
const holeOf = (what: string): number => g.holes.findIndex((h) => h.up && h.what === what);

// one-shot events on the trailer timeline
const events: { at: number; fn: () => void; done?: boolean }[] = [];
const at = (t: number, fn: () => void): void => void events.push({ at: t, fn });

at(0, () => music.start());
// the mice of the day: each hat is a character (wand, crown, balloon, beard, eyepatch…)
const PARADE = [dailyVariant(), 5, 88, 60];
PARADE.forEach((v, i) => at(11.0 + i * 0.45, () => g.spawn(vt, "fancy", v)));
at(15.2, () => {
  g.spawn(vt, "porcupine");
  forced.push({ at: 15.85, hole: () => holeOf("porcupine") });
});
at(15.6, () => g.spawn(vt, "snake"));
at(19.6, () => {
  g.spawn(vt, "freeze");
  forced.push({ at: 20.1, hole: () => holeOf("freeze") });
});
at(20.0, () => {
  for (let k = 0; k < 4; k++) g.spawn(vt, "mouse");
});
at(24.3, () => g.spawn(vt, "lizard"));
at(25.9, () => g.spawn(vt, "lizard"));
at(27.0, () => g.spawn(vt, "lizard"));

// cat showcase
const SKINS = [
  ["orange", "Orange Tabby"], ["badger", "Badger"], ["black", "Black Cat"],
  ["white", "White Cat"], ["calico", "Calico"], ["tilcayo", "Tilcayo"]
] as const;
let skinLabel = { name: "Grey Tabby", at: 0 };
at(28.2, () => {
  const p = (lawn as unknown as { cats: { model: { root: { position: InstanceType<typeof THREE.Vector3> } } }[] }).cats[0]!.model.root.position;
  setCam(TALL ? { target: p.clone().add(new THREE.Vector3(0.1, 1.1, 0.2)), dist: 8.6 } : { target: p.clone().add(new THREE.Vector3(0.9, 0.9, 0.4)), dist: 7.2 });
  skinLabel = { name: "Grey Tabby", at: vt };
});
SKINS.forEach(([id, name], i) => {
  at(28.9 + i * 0.85, () => {
    lawn.setCatSkin(1, id);
    sfx.powerCollect();
    skinLabel = { name, at: vt };
  });
});
at(34.4, () => setCam(null));

// 1v1, scripted on the duel lawn
at(34.8, () => sfx.stage());
at(38.9, () => {
  sfx.record();
  duel.cat(1, "catch", 1600);
  duel.cat(2, "angry", 1600);
});
const duelScore: [number, number] = [0, 0];
const duelUp = new Map<number, string>();
let duelNext = 0;
function duelTick(): void {
  if (T < 34.2 || T > 40.4 || vt < duelNext) return;
  duelNext = vt + 170 + Math.random() * 120;
  const free = Array.from({ length: 25 }, (_, i) => i).filter((i) => !duelUp.has(i));
  if (duelUp.size < 4 && free.length) {
    const hole = free[Math.floor(Math.random() * free.length)]!;
    const kind = T > 36.4 && T < 36.7 ? "lizard" : "mouse";
    duel.raise(hole, kind);
    duelUp.set(hole, kind);
    sfx.squeak();
    window.setTimeout(() => {
      if (!duelUp.has(hole)) return;
      // a close match that you edge out: the rival only scores while you are a few ahead
      const lead = duelScore[0] - duelScore[1];
      const by = (kind !== "lizard" && ((lead >= 2 && Math.random() < 0.6) || (lead === 1 && Math.random() < 0.25)) ? 2 : 1) as 1 | 2;
      const gain = kind === "lizard" ? 2 : 1;
      duelUp.delete(hole);
      duel.slap(hole, by, "catch", "");
      window.setTimeout(() => duel.pop(hole, `+${gain}`, by === 1 ? "catch" : "rival"), 160);
      duel.cat(by, "catch", 700);
      duelScore[by - 1] += gain;
      sfx.catch();
    }, 300 + Math.random() * 260);
  }
}

// ---- painting ---------------------------------------------------------------------------------
const out = outEl;
const ctx = out.getContext("2d")!;
const INK = "#2e1a26";
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOut = (x: number): number => 1 - Math.pow(1 - clamp01(x), 3);
const easeBack = (x: number): number => {
  const c = 1.9;
  const t = clamp01(x) - 1;
  return 1 + (c + 1) * t * t * t + c * t * t;
};

function text(s: string, x: number, y: number, size: number, fill: string | CanvasGradient, alpha = 1, align: CanvasTextAlign = "center"): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 ${size}px Fredoka`;
  // shrink anything wider than the frame (with a margin) so nothing gets cut off
  const room = (TALL ? W - 220 : W - 120) * (align === "center" ? 1 : 0.9);
  const wide = ctx.measureText(s).width;
  if (wide > room) {
    size = Math.floor((size * room) / wide);
    ctx.font = `700 ${size}px Fredoka`;
  }
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(20,8,20,.45)";
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.08;
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = INK;
  ctx.strokeText(s, x, y);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
  ctx.restore();
}

function gold(y: number, size: number): CanvasGradient {
  const gr = ctx.createLinearGradient(0, y - size, 0, y);
  gr.addColorStop(0, "#fffbe6");
  gr.addColorStop(0.45, "#ffe68a");
  gr.addColorStop(0.5, "#ffd23f");
  gr.addColorStop(1, "#ff9a2a");
  return gr;
}

function caption(title: string, sub: string, t0: number, t1: number): void {
  if (T < t0 || T > t1) return;
  const inK = easeBack((T - t0) / 0.45);
  const outK = clamp01((t1 - T) / 0.3);
  const a = Math.min(clamp01((T - t0) / 0.2), outK);
  const dy = (1 - inK) * 60 + (1 - outK) * 30;
  // a soft dark band behind the words
  const bottom = TALL ? H - 400 : H;
  const bandH = TALL ? 340 : 260;
  const band = ctx.createLinearGradient(0, bottom - bandH, 0, bottom);
  band.addColorStop(0, "rgba(20,10,28,0)");
  band.addColorStop(0.5, "rgba(20,10,28,.55)");
  band.addColorStop(1, TALL ? "rgba(20,10,28,0)" : "rgba(20,10,28,.75)");
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = band;
  ctx.fillRect(0, bottom - bandH, W, TALL ? bandH + 60 : bandH);
  ctx.restore();
  const ty = TALL ? bottom - 150 : H - 112;
  const size = TALL ? 86 : 78;
  text(title, W / 2, ty + dy, size, gold(ty + dy, size), a);
  if (sub) text(sub, W / 2, ty + (TALL ? 72 : 62) + dy, TALL ? 44 : 40, "#fff6ea", a);
}

function drawLogo(cx: number, cy: number, width: number, alpha = 1, scale = 1): void {
  const w = width * scale;
  const h = (w * logo.height) / logo.width;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(10,5,15,.5)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

const POP_COLORS: Record<string, string> = {
  catch: "#fff6ea", fancy: "#ffd66b", rival: "#7fe0c3", prick: "#ff8a5c", bite: "#ff8a5c", ouch: "#ff8a5c",
  gulp: "#9be27a", whiff: "#dccbc6", lick: "#9fe3ff", collect: "#7fffe0"
};
const duelOnScreen = (): boolean => T >= 34.6 && T < 40.6;
function drawPops(): void {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]!;
    const k = (vt - p.at) / 900;
    if (p.duel !== duelOnScreen()) {
      if (k >= 1) pops.splice(i, 1);
      continue;
    }
    if (k >= 1) {
      pops.splice(i, 1);
      continue;
    }
    const s = k < 0.18 ? 0.6 + easeBack(k / 0.18) * 0.4 : 1;
    const size = (p.kind === "fancy" ? 64 : 54) * s;
    text(p.text, p.x, p.y - easeOut(k) * 80, size, POP_COLORS[p.kind] ?? "#fff6ea", k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
  }
}

function drawCallouts(): void {
  for (let i = callouts.length - 1; i >= 0; i--) {
    const c = callouts[i]!;
    const k = (vt - c.at) / 1200;
    if (k >= 1 || i < callouts.length - 1) {
      if (k >= 1) callouts.splice(i, 1);
      continue;
    }
    const s = easeBack(k / 0.25);
    const a = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
    ctx.save();
    ctx.translate(W / 2, TALL ? 470 : 250);
    ctx.rotate(-0.04);
    ctx.scale(s, s);
    text(c.text, 0, 0, 84, c.color === "#ffd66b" ? gold(0, 84) : c.color, a);
    ctx.restore();
  }
}

function hud(alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(46,33,58,.86)";
  ctx.beginPath();
  const top = TALL ? 270 : 26;
  ctx.roundRect(28, top, 230, 86, 43);
  ctx.fill();
  ctx.restore();
  ctx.font = "700 60px Fredoka";
  const w = ctx.measureText(String(g.score)).width;
  text(String(g.score), 62, top + 66, 60, gold(top + 66, 60), alpha, "left");
  text("mice", 62 + w + 14, top + 62, 32, "#dccbc6", alpha, "left");
  if (TALL) drawLogo(W / 2, 150, 520, alpha * 0.95);
  else drawLogo(W - 175, 75, 300, alpha * 0.95);
}

function frost(): void {
  if (g.power !== "freeze") return;
  const gr = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
  gr.addColorStop(0, "rgba(143,233,255,0.06)");
  gr.addColorStop(1, "rgba(143,233,255,0.45)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

function vignette(strength = 0.38): void {
  const gr = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  gr.addColorStop(0, "rgba(10,5,15,0)");
  gr.addColorStop(1, `rgba(10,5,15,${strength})`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
}

const canvas1 = document.querySelector("#stage1 canvas") as HTMLCanvasElement;
const canvas2 = document.querySelector("#stage2 canvas") as HTMLCanvasElement;

function base(c: HTMLCanvasElement, alpha = 1, blur = 0, dim = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (blur > 0.1 || dim < 1) ctx.filter = `blur(${blur.toFixed(1)}px) brightness(${dim.toFixed(2)})`;
  const pad = blur * 2;
  ctx.drawImage(c, -pad, -pad, W + pad * 2, H + pad * 2);
  ctx.restore();
}

function duelTags(alpha: number): void {
  const cats = (duel as unknown as { cats: { model: { root: { position: InstanceType<typeof THREE.Vector3> } } }[]; toScreen(p: InstanceType<typeof THREE.Vector3>): { x: number; y: number } }).cats;
  const toScreen = (duel as unknown as { toScreen(p: InstanceType<typeof THREE.Vector3>): { x: number; y: number } }).toScreen.bind(duel);
  cats.forEach((c, i) => {
    const p = toScreen(c.model.root.position.clone().add(new THREE.Vector3(0, 2.45, 0)));
    const label = `${i === 0 ? "You" : "Rival"}  ${duelScore[i]}`;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "700 34px Fredoka";
    const w = ctx.measureText(label).width + 44;
    ctx.fillStyle = i === 0 ? "rgba(255,174,66,.95)" : "rgba(127,224,195,.95)";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, p.y - 32, w, 54, 27);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2a140a";
    ctx.textAlign = "center";
    ctx.fillText(label, p.x, p.y + 6);
    ctx.restore();
  });
}

function paint(): void {
  // base layer: solo lawn, the duel lawn, crossfades between them
  const blurIntro = T < 3.1 ? 9 : T < 3.9 ? 9 * (1 - (T - 3.1) / 0.8) : 0;
  const endK = clamp01((T - 40.4) / 0.6);
  if (T < 34.4) base(canvas1, 1, blurIntro, 1 - 0.4 * (blurIntro / 9));
  else if (T < 34.8) {
    base(canvas1);
    base(canvas2, (T - 34.4) / 0.4);
  } else if (T < 40.4) base(canvas2);
  else {
    base(canvas2);
    base(canvas1, endK, 9 * endK, 1 - 0.45 * endK);
  }
  if (T < 34.4) frost();
  vignette(T < 4 || T > 40.4 ? 0.55 : 0.38);
  if (CLEAN) return;
  if (T > 3.7 && T < 40.6) drawPops();
  else pops.length = 0;
  if (T > 4 && T < 34.4) drawCallouts();

  // intro
  if (T < 4.2) {
    const a = T > 3.6 ? 1 - (T - 3.6) / 0.6 : 1;
    drawLogo(W / 2, H / 2 - (TALL ? 200 : 70), Math.min(1000, W * 0.9), a, 0.35 + 0.65 * easeBack((T - 0.15) / 0.75));
    if (T > 1.3) text("Catch the mice. Collect the cats.", W / 2, H / 2 + (TALL ? 140 : 300), TALL ? 64 : 58, "#fff6ea", Math.min(a, clamp01((T - 1.3) / 0.4)));
  }

  // in-game HUD
  const hudA = T < 4.2 ? 0 : T < 4.6 ? (T - 4.2) / 0.4 : T < 28.0 ? 1 : T < 28.4 ? 1 - (T - 28.0) / 0.4 : 0;
  hud(hudA);

  caption("Tap the mice!", "Never go 5 seconds without a catch", 4.4, 10.8);
  caption("100 mice of the day", "Each one a character. Catch 20 a day!", 11.0, 15.0);
  caption("Don't slap the grumpy porcupine", "…or the snake. Sore paws need licking!", 15.2, 19.4);
  caption("Freeze the whole lawn", "Everything stops. Except your paw.", 19.6, 23.9);
  caption("New: the yellow lizard", "Worth 2 mice!", 24.1, 28.0);
  caption("Collect 7 cats", "Earn points every round, or get 50,000 for $3.44", 28.2, 34.3);
  caption("PvP: duel your friends 1v1", "Real-time online · quick match or private room", 34.7, 40.2);

  // cat name chip during the showcase
  if (T > 28.4 && T < 34.3) {
    const k = (vt - skinLabel.at) / 1000;
    const s = easeBack(k / 0.3);
    ctx.save();
    ctx.translate(TALL ? W / 2 : W * 0.68, TALL ? 470 : H * 0.36);
    ctx.rotate(0.05);
    ctx.scale(s, s);
    ctx.font = "700 70px Fredoka";
    const w = ctx.measureText(skinLabel.name).width + 70;
    ctx.fillStyle = "#ff7aa6";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -58, w, 100, 50);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.translate(TALL ? W / 2 : W * 0.68, TALL ? 470 : H * 0.36);
    ctx.rotate(0.05);
    ctx.scale(s, s);
    text(skinLabel.name, 0, 14, 70, "#ffffff");
    ctx.restore();
  }

  if (T > 34.6 && T < 40.4) duelTags(clamp01((T - 34.6) / 0.3) * clamp01((40.4 - T) / 0.3));
  // PvP beats: a VS splash, then the winner
  if (T > 34.8 && T < 36.4) {
    const k = (T - 34.8) / 1.6;
    ctx.save();
    ctx.translate(W / 2, TALL ? 560 : 330);
    ctx.rotate(-0.08);
    ctx.scale(easeBack(k / 0.25) * (1 + 0.04 * Math.sin(T * 18)), easeBack(k / 0.25));
    text("VS", 0, 0, 190, gold(0, 190), k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1);
    ctx.restore();
  }
  if (T > 38.9 && T < 40.3) {
    const k = (T - 38.9) / 1.4;
    ctx.save();
    ctx.translate(W / 2, TALL ? 560 : 300);
    ctx.rotate(-0.04);
    ctx.scale(easeBack(k / 0.2), easeBack(k / 0.2));
    text("You win the match!", 0, 0, 104, gold(0, 104), k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1);
    ctx.restore();
  }

  // end card
  if (T > 40.6) {
    const k = (T - 40.6) / 0.8;
    const cy = TALL ? H / 2 - 260 : H / 2;
    drawLogo(W / 2, cy - 110, Math.min(1060, W * 0.92), clamp01(k * 1.5), 0.4 + 0.6 * easeBack(k));
    const pk = clamp01((T - 41.5) / 0.5);
    if (pk > 0) {
      const s = easeBack(pk);
      ctx.save();
      ctx.translate(W / 2, cy + 270);
      ctx.scale(s, s);
      ctx.fillStyle = "#ffae42";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(-330, -62, 660, 124, 62);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.35)";
      ctx.beginPath();
      ctx.roundRect(-300, -52, 600, 40, 20);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, cy + 270);
      ctx.scale(s, s);
      text("▶ PLAY FREE", 0, 24, 66, "#ffffff");
      ctx.restore();
    }
    const uk = clamp01((T - 42.1) / 0.5);
    if (uk > 0) {
      text("catthemouse.co", W / 2, cy + 410, 64, gold(cy + 410, 64), uk);
      text("Free in your browser · 50,000 pts for $3.44", W / 2, cy + 470, 34, "#dccbc6", uk);
    }
  }
}

// ---- run ------------------------------------------------------------------------------------
const FRAME_MS = 1000 / FPS;
statusEl.textContent = "pre-roll…";
game.start();
for (let i = 0; i < 46 * 20; i++) {
  T = -1;
  g.nextFoeAt = g.nextSnakeAt = g.nextPowerAt = g.nextLizardAt = Infinity;
  g.plainSinceFancy = 0;
  autoplay();
  g.deadline = Math.max(g.deadline, vt + 4000);
  step(50);
  await breathe();
}

recording = true;
audioT0 = vt;
const total = DUR * FPS;
for (let f = 0; f < total; f++) {
  T = f / FPS;
  for (const e of events) {
    if (!e.done && T >= e.at) {
      e.done = true;
      e.fn();
    }
  }
  // keep the scripted scenes in charge of hazards, power-ups and fancy mice
  if (T < 15.2 || T > 19.6) g.nextFoeAt = g.nextSnakeAt = Infinity;
  g.nextPowerAt = g.nextLizardAt = Infinity;
  g.plainSinceFancy = 0;
  g.deadline = Math.max(g.deadline, vt + 4000);
  autoplay();
  duelTick();
  step(FRAME_MS);
  paint();
  if (PREVIEW !== null) {
    if (PREVIEW.length && T >= PREVIEW[0]!) {
      const still = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), "image/jpeg", 0.85));
      await fetch(`${SINK}/?name=p-${PREVIEW.shift()}.jpg`, { method: "POST", body: still });
    }
    if (!PREVIEW.length) break;
    await breathe();
    continue;
  }
  const blob = await new Promise<Blob>((res) => out.toBlob((b) => res(b!), "image/jpeg", 0.93));
  await fetch(`${SINK}/?name=f${String(f).padStart(5, "0")}.jpg`, { method: "POST", body: blob });
  if (f % 15 === 0) statusEl.textContent = `frame ${f}/${total} · lizards ${lizardCaught}`;
}
music.stop();
if (PREVIEW !== null) {
  statusEl.textContent = `preview done at ${T.toFixed(2)} s`;
  (window as unknown as Record<string, unknown>).__trailerDone = true;
  throw new Error("preview only");
}

statusEl.textContent = "rendering audio…";
const buffer = await offline.startRendering();
await fetch(`${SINK}/?name=audio.wav`, { method: "POST", body: wav(buffer) });
statusEl.textContent = "done";
(window as unknown as Record<string, unknown>).__trailerDone = true;

function wav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels;
  const len = b.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string): void => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, b.sampleRate, true);
  data.setUint32(28, b.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c]![i]!));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

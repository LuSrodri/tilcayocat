// Cat lab (dev only: /tools/catlab.html with `npm run dev`). Films the cat through a scripted
// sequence on a virtual clock and uploads a contact sheet (one tile every STEP ms) to the local
// receiver, to check its animations frame by frame. ?sink=http://localhost:5288

export {};

const STEP = 100;
const COLS = 10;
const TILE = 200;
const SINK = new URLSearchParams(location.search).get("sink") ?? "http://localhost:5288";
const statusEl = document.getElementById("status")!;

let vt = 1000;
interface Timer { id: number; at: number; fn: () => void; every: number }
let timers: Timer[] = [];
let nextId = 1;
let rafs = new Map<number, FrameRequestCallback>();
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
const channel = new MessageChannel();
const waiting: (() => void)[] = [];
channel.port1.onmessage = () => waiting.shift()?.();
const breathe = (): Promise<void> => new Promise((r) => (waiting.push(r), channel.port2.postMessage(0)));

function step(ms: number): void {
  vt += ms;
  for (let guard = 0; guard < 500; guard++) {
    const due = timers.filter((t) => t.at <= vt).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    if (due.every) due.at += due.every;
    else timers = timers.filter((t) => t !== due);
    due.fn();
  }
  const cbs = [...rafs.values()];
  rafs = new Map();
  for (const cb of cbs) cb(vt);
}

const THREE = await import("three");
const { Lawn } = await import("../src/engine/lawn");
const lawn = new Lawn({ container: document.getElementById("stage")!, cats: 1, insets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) });
const L = lawn as unknown as Record<string, unknown> & {
  fit: () => void; fitDirty: boolean; wantTarget: InstanceType<typeof THREE.Vector3>; wantDist: number;
  cats: { model: { root: { position: InstanceType<typeof THREE.Vector3> } } }[];
};
L.watchFrameRate = () => {};
let built = false;
void lawn.ready.then(() => (built = true));
while (!built) {
  step(16);
  await breathe();
}
lawn.setActive([6, 7, 8, 11, 12, 13], false);
for (let i = 0; i < 30; i++) step(33);
// frame the cat, from a lower angle than the game camera so the face reads
L.elevation = THREE.MathUtils.degToRad(Number(new URLSearchParams(location.search).get("elev") ?? 30));
L.fit = () => {
  L.fitDirty = false;
  L.wantTarget.copy(L.cats[0]!.model.root.position.clone().add(new THREE.Vector3(0.7, 1.0, 0.6)));
  L.wantDist = Number(new URLSearchParams(location.search).get("dist") ?? 4.6);
};
L.fitDirty = true;
for (let i = 0; i < 30; i++) step(33);

// the script, in ms from the start
const script: [number, () => void][] = [
  [300, () => lawn.raise(12, "mouse")],
  [1000, () => {
    lawn.slap(12, 1, "catch", "");
    lawn.cat(1, "catch", 900);
  }],
  [2300, () => lawn.slap(7, 1, "whiff", "")],
  [2350, () => lawn.cat(1, "angry", 650)],
  [3400, () => lawn.raise(8, "porcupine")],
  [3800, () => {
    lawn.slap(8, 1, "prick", "Ouch!");
    window.setTimeout(() => lawn.lick(1, 1700), 300);
  }],
  [6200, () => lawn.setActive([6, 7, 8, 11, 12, 13, 16, 17, 18, 1, 2, 3], true)],
  [8300, () => lawn.cat(1, "sad")]
];
const DURATION = 9000;
const rows = Math.ceil(DURATION / STEP / COLS);
const sheet = document.createElement("canvas");
sheet.width = COLS * TILE;
sheet.height = rows * TILE;
const sctx = sheet.getContext("2d")!;
const src = document.querySelector("#stage canvas") as HTMLCanvasElement;
let t = 0;
let tile = 0;
const FRAME = 1000 / 30;
while (t < DURATION) {
  for (const s of script) if (s[0] > t - FRAME && s[0] <= t) s[1]();
  step(FRAME);
  t += FRAME;
  if (t >= tile * STEP) {
    sctx.drawImage(src, (tile % COLS) * TILE, Math.floor(tile / COLS) * TILE, TILE, TILE);
    sctx.fillStyle = "#fff";
    sctx.font = "bold 14px system-ui";
    sctx.fillText(String(tile * STEP), (tile % COLS) * TILE + 6, Math.floor(tile / COLS) * TILE + 18);
    tile++;
  }
  await breathe();
}
const blob = await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), "image/jpeg", 0.85));
await fetch(`${SINK}/?name=catlab.jpg`, { method: "POST", body: blob });
statusEl.textContent = "done";
(window as unknown as Record<string, unknown>).__catlabDone = true;

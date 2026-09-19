import { sfx } from "./sound";
import { createHoleEl, burst } from "./holes";

export const CATCH_WINDOW_MS = 5000;
// Each catch buys a little time back instead of refilling the whole window.
export const CATCH_BONUS_MS = 800;
// Slapping an empty hole costs time; slapping a porcupine costs a lot more.
export const MISS_PENALTY_MS = 300;
export const PORCUPINE_PENALTY_MS = 2000;
export const START_GRID = 2;
export const MAX_GRID = 5;
const BEST_KEY = "tilcayo.best";

// Time-based progression (game time, frozen seconds excluded): the lawn grows and the mice speed up.
interface Stage { at: number; grid?: number; faster?: boolean }
const STAGES: Stage[] = [
  { at: 10000, grid: 3 },
  { at: 25000, faster: true },
  { at: 35000, grid: 4 },
  { at: 60000, faster: true },
  { at: 75000, grid: 5 }
];
const LATE_SPEED_EVERY_MS = 15000;
const SPEED_STEP = 1.1;

export type PowerKind = "auto" | "fulltime" | "freeze";
export const POWER_DURATION: Record<PowerKind, number> = { auto: 6000, fulltime: 0, freeze: 4000 };
export const POWER_LABEL: Record<PowerKind, string> = { auto: "Auto-catch", fulltime: "Full time", freeze: "Freeze" };
const POWER_KINDS: PowerKind[] = ["auto", "fulltime", "freeze"];

type Occupant = "mouse" | "porcupine" | PowerKind;

interface Hole {
  el: HTMLButtonElement;
  up: boolean;
  what: Occupant;
  hideAt: number;
  autoAt: number;
}

export type CatState = "idle" | "catch" | "angry" | "sad";

export interface GameCallbacks {
  onScore(score: number, best: number): void;
  onTimer(remainingMs: number): void;
  onPower(kind: PowerKind | null, remainingMs: number, totalMs: number): void;
  onStage(grid: number, speed: number, note: string): void;
  onGameOver(score: number, best: number, isNewBest: boolean): void;
}

export class Game {
  private holes: Hole[] = [];
  private score = 0;
  private best = 0;
  private running = false;
  private deadline = 0;
  private nextSpawnAt = 0;
  private nextPowerAt = 0;
  private nextFoeAt = 0;
  private raf = 0;
  private lastFrame = 0;
  private lastAlertAt = 0;
  private catTimer = 0;
  private power: PowerKind | null = null;
  private powerUntil = 0;
  private elapsed = 0;
  private grid = START_GRID;
  private speed = 1;
  private stageIdx = 0;
  private nextLateSpeedAt = 0;

  constructor(
    private readonly holesEl: HTMLElement,
    private readonly catEl: HTMLElement,
    private readonly cb: GameCallbacks
  ) {
    this.best = readBest();
    this.buildHoles(START_GRID);
    this.catEl.classList.add("is-idle");
    this.cb.onScore(0, this.best);
    this.cb.onTimer(CATCH_WINDOW_MS);
    this.cb.onPower(null, 0, 0);
  }

  get bestScore(): number {
    return this.best;
  }

  start(): void {
    this.reset();
    this.running = true;
    const now = performance.now();
    this.lastFrame = now;
    this.deadline = now + CATCH_WINDOW_MS;
    this.nextSpawnAt = now + 350;
    this.nextPowerAt = now + 25000 + Math.random() * 15000;
    this.nextFoeAt = now + 8000 + Math.random() * 6000;
    this.catEl.classList.remove("is-sad");
    this.catEl.classList.add("is-idle");
    this.setCat("idle");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private reset(): void {
    this.score = 0;
    this.elapsed = 0;
    this.speed = 1;
    this.stageIdx = 0;
    this.nextLateSpeedAt = STAGES[STAGES.length - 1]!.at + LATE_SPEED_EVERY_MS;
    this.setPower(null);
    if (this.grid !== START_GRID) this.buildHoles(START_GRID);
    for (const h of this.holes) this.lower(h);
    this.cb.onStage(this.grid, this.speed, "");
    this.cb.onScore(0, this.best);
    this.cb.onTimer(CATCH_WINDOW_MS);
  }

  private buildHoles(grid: number): void {
    this.grid = grid;
    this.holes = [];
    this.holesEl.replaceChildren();
    this.holesEl.style.setProperty("--grid", String(grid));
    this.holesEl.dataset.grid = String(grid);
    for (let i = 0; i < grid * grid; i++) {
      const el = createHoleEl(i);
      const hole: Hole = { el, up: false, what: "mouse", hideAt: 0, autoAt: 0 };
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this.tap(hole);
      });
      this.holes.push(hole);
      this.holesEl.append(el);
    }
  }

  // Pace is driven by the stage speed multiplier, not by the score.
  private upTime(): number {
    return clamp(1600 / this.speed, 450, 1600);
  }
  private spawnGap(): number {
    return clamp(800 / this.speed, 220, 800);
  }
  private simultaneous(): number {
    // 2×2 → 1 mouse, 3×3 → 2, 4×4 → 2, 5×5 → 3; late speed-ups add one every two steps (max 5)
    const base = this.grid <= 2 ? 1 : this.grid <= 4 ? 2 : 3;
    const late = Math.max(0, Math.round(Math.log(this.speed) / Math.log(SPEED_STEP)) - 2);
    return Math.min(5, base + Math.floor(late / 2));
  }

  private advance(now: number): void {
    const stage = STAGES[this.stageIdx];
    if (stage && this.elapsed >= stage.at) {
      this.stageIdx++;
      if (stage.grid) {
        this.grow(stage.grid, now);
        return;
      }
      if (stage.faster) this.speedUp();
      return;
    }
    if (this.stageIdx >= STAGES.length && this.elapsed >= this.nextLateSpeedAt) {
      this.nextLateSpeedAt += LATE_SPEED_EVERY_MS;
      this.speedUp();
    }
  }

  private speedUp(): void {
    this.speed = Math.round(this.speed * SPEED_STEP * 1000) / 1000;
    sfx.stage();
    this.cb.onStage(this.grid, this.speed, `Speed ×${this.speed.toFixed(2)}`);
  }

  // Rebuild the lawn with more holes; whatever was up goes back underground.
  private grow(grid: number, now: number): void {
    this.buildHoles(grid);
    this.nextSpawnAt = now + 600;
    sfx.stage();
    this.cb.onStage(this.grid, this.speed, `${grid} × ${grid}`);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    // Freeze: the clock stops, mice stay put and nothing new comes out.
    const frozen = this.power === "freeze";
    if (frozen) {
      this.deadline += dt;
      this.nextSpawnAt += dt;
      this.nextFoeAt += dt;
      for (const h of this.holes) if (h.up) h.hideAt += dt;
    }

    if (!frozen) {
      this.elapsed += dt;
      this.advance(now);
    }

    if (this.power && now >= this.powerUntil) this.setPower(null);
    if (this.power) this.cb.onPower(this.power, this.powerUntil - now, POWER_DURATION[this.power]);

    const remaining = this.deadline - now;
    this.cb.onTimer(Math.max(0, remaining));

    if (remaining <= 0) {
      this.end();
      return;
    }
    if (remaining < 1500 && now - this.lastAlertAt > 1500) {
      this.lastAlertAt = now;
      this.catEl.classList.add("is-alert");
    }

    for (const h of this.holes) {
      if (!h.up) continue;
      if (frozen) continue;
      if (h.what === "mouse" && this.power === "auto" && now >= h.autoAt) {
        this.catchMouse(h);
        continue;
      }
      if (now >= h.hideAt) {
        this.lower(h);
        if (h.what === "mouse") this.escaped(h);
      }
    }

    if (!frozen && now >= this.nextSpawnAt) {
      const upMice = this.holes.filter((h) => h.up && h.what === "mouse").length;
      if (upMice < this.simultaneous()) this.spawn(now, "mouse");
      this.nextSpawnAt = now + this.spawnGap() * (0.7 + Math.random() * 0.6);
    }

    // A porcupine pokes its head out now and then. Slap it and you lose 2 seconds.
    if (!frozen && now >= this.nextFoeAt) {
      if (!this.holes.some((h) => h.up && h.what === "porcupine")) this.spawn(now, "porcupine");
      this.nextFoeAt = now + 10000 + Math.random() * 8000;
    }

    // Power-ups show up now and then, never while one is already up or running.
    if (now >= this.nextPowerAt) {
      const powerUp = this.holes.some((h) => h.up && h.what !== "mouse");
      if (!powerUp && !this.power) this.spawn(now, POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)]!);
      this.nextPowerAt = now + 30000 + Math.random() * 20000;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private spawn(now: number, what: Occupant): void {
    const free = this.holes.filter((h) => !h.up && !h.el.classList.contains("is-caught"));
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)]!;
    hole.up = true;
    hole.what = what;
    hole.el.dataset.what = what;
    if (what === "mouse") {
      hole.hideAt = now + this.upTime() * (0.8 + Math.random() * 0.4);
      hole.autoAt = now + 140;
      sfx.squeak();
    } else if (what === "porcupine") {
      hole.hideAt = now + 2200;
      sfx.grunt();
    } else {
      hole.hideAt = now + 2600;
      sfx.powerUp();
    }
    hole.el.classList.add("is-up");
  }

  private lower(hole: Hole): void {
    hole.up = false;
    hole.el.classList.remove("is-up");
  }

  // A mouse went back down uncaught: the cat is not amused.
  private escaped(hole: Hole): void {
    hole.el.classList.remove("is-escaped");
    void hole.el.offsetWidth;
    hole.el.classList.add("is-escaped");
    setTimeout(() => hole.el.classList.remove("is-escaped"), 500);
    this.setCat("angry", 650);
  }

  // Swap the cat sprite; a duration makes it fall back to idle afterwards.
  private setCat(state: CatState, duration?: number): void {
    window.clearTimeout(this.catTimer);
    this.catEl.dataset.state = state;
    if (duration) {
      this.catTimer = window.setTimeout(() => {
        if (this.running) this.catEl.dataset.state = "idle";
      }, duration);
    }
  }

  private setPower(kind: PowerKind | null): void {
    this.power = kind;
    this.powerUntil = kind ? performance.now() + POWER_DURATION[kind] : 0;
    this.catEl.dataset.power = kind ?? "";
    this.holesEl.dataset.power = kind ?? "";
    this.cb.onPower(kind, kind ? POWER_DURATION[kind] : 0, kind ? POWER_DURATION[kind] : 0);
  }

  private tap(hole: Hole): void {
    if (!this.running) return;
    sfx.unlock();
    if (!hole.up) {
      this.whiff(hole);
      return;
    }
    if (hole.what === "mouse") {
      this.catchMouse(hole);
    } else if (hole.what === "porcupine") {
      this.prick(hole);
    } else {
      this.collect(hole, hole.what);
    }
  }

  private whiff(hole: Hole): void {
    sfx.miss();
    this.deadline -= MISS_PENALTY_MS;
    this.burst(hole, "is-whiff", `−${(MISS_PENALTY_MS / 1000).toFixed(1)}s`, 450);
    this.setCat("angry", 450);
  }

  // Ouch: the porcupine stays put and the clock takes the hit.
  private prick(hole: Hole): void {
    sfx.ouch();
    this.deadline -= PORCUPINE_PENALTY_MS;
    this.burst(hole, "is-whiff is-prick", `−${PORCUPINE_PENALTY_MS / 1000}s`, 650);
    this.setCat("angry", 900);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
  }

  private catchMouse(hole: Hole): void {
    hole.up = false;
    hole.el.classList.remove("is-up");
    this.burst(hole, "is-caught", "+1", 550);

    this.score += 1;
    this.deadline = Math.min(this.deadline + CATCH_BONUS_MS, performance.now() + CATCH_WINDOW_MS);
    this.catEl.classList.remove("is-alert");
    this.catEl.classList.remove("is-pounce");
    void this.catEl.offsetWidth; // restart animation
    this.catEl.classList.add("is-pounce");
    this.setCat("catch", 900);
    sfx.catch();
    if (navigator.vibrate) navigator.vibrate(12);
    this.cb.onScore(this.score, Math.max(this.best, this.score));
  }

  private collect(hole: Hole, kind: PowerKind): void {
    hole.up = false;
    hole.el.classList.remove("is-up");
    this.burst(hole, "is-caught is-collected", POWER_LABEL[kind], 700);
    sfx.powerCollect();
    if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
    if (kind === "fulltime") {
      this.deadline = performance.now() + CATCH_WINDOW_MS;
      this.cb.onPower("fulltime", 0, 0);
      this.setPower(null);
      return;
    }
    this.setPower(kind);
  }

  private burst(hole: Hole, classes: string, label: string, ms: number): void {
    burst(hole.el, classes, label, ms);
  }

  private end(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.setPower(null);
    for (const h of this.holes) this.lower(h);
    this.catEl.classList.remove("is-idle", "is-alert");
    this.catEl.classList.add("is-sad");
    this.setCat("angry");
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      writeBest(this.best);
    }
    sfx.over();
    if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    this.cb.onGameOver(this.score, this.best, isNewBest);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(v: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

import { sfx } from "./sound";
import { Lawn, HOLES, neighbours, type Critter } from "./engine/lawn";
import { FANCY_EVERY, dailyVariant } from "./fancy";
import { LIZARD_VALUE } from "./shop";

export const CATCH_WINDOW_MS = 5000;
// Each catch buys a little time back instead of refilling the whole window.
export const CATCH_BONUS_MS = 800;
export const MISS_PENALTY_MS = 300;
// Slapping a porcupine or a snake hurts: the cat licks its paw and can't hunt for a while.
export const PORCUPINE_LICK_MS = 2000;
export const SNAKE_LICK_MS = 3000;
// Every abrupt screen change gets a short grace period so a stray tap doesn't count.
export const GUARD_MS = 1250;

// The lawn grows one hole at a time: four to start, then a new one every few seconds, dug
// from the middle outwards. Each new hole is announced by a wiggling mound first.
export const START_HOLES = [7, 11, 13, 17];
export const FIRST_NEW_HOLE_MS = 8000;
export const NEW_HOLE_EVERY_MS = 4500;
export const TELEGRAPH_MS = 1500;
export const HOLE_ORDER: number[] = holeOrder();
/** Game time (ms) at which each hole beyond the first four opens. */
export const HOLE_TIMES: number[] = HOLE_ORDER.slice(START_HOLES.length).map((_, i) => FIRST_NEW_HOLE_MS + i * NEW_HOLE_EVERY_MS);
export const FULL_LAWN_MS = HOLE_TIMES[HOLE_TIMES.length - 1]!;

// Catches closer together than this keep the combo going; an escape or a slap breaks it.
export const COMBO_WINDOW_MS = 1500;
// Catches per 10-second slice, kept for the share card's heat strip.
export const SLICE_MS = 10000;
export const DAILY_GOAL = 10;
const BEST_KEY = "tilcayo.best";
// The yellow lizard (bought in the shop) darts out now and then; it is quick and worth two mice.
export const LIZARD_FIRST_MS = 12000;

export type PowerKind = "auto" | "fulltime" | "freeze";
export const POWER_DURATION: Record<PowerKind, number> = { auto: 6000, fulltime: 0, freeze: 4000 };
export const POWER_LABEL: Record<PowerKind, string> = { auto: "Auto-catch", fulltime: "Full time", freeze: "Freeze" };
const POWER_KINDS: PowerKind[] = ["auto", "fulltime", "freeze"];

interface Hole {
  open: boolean;
  up: boolean;
  what: Critter;
  variant: number | null;
  upAt: number;
  hideAt: number;
  autoAt: number;
  busyUntil: number;
  // fancy mice hop around; snakes bite their neighbours
  hopsLeft: number;
  nextBiteAt: number;
}

// Round events, consumed by the seal tracker and the daily challenge.
export type GameEvent =
  | { type: "start" }
  | { type: "time"; elapsed: number }
  | { type: "catch"; score: number; combo: number; lizard?: boolean }
  | { type: "fancy"; variant: number; count: number; elapsed: number }
  | { type: "escape" }
  | { type: "eaten"; fancy: boolean }
  | { type: "whiff" }
  | { type: "prick" }
  | { type: "bite" }
  | { type: "power"; kind: PowerKind };

// What a finished round looked like, for the results screen and the share card.
export interface RoundStats {
  score: number;
  points: number;
  elapsedMs: number;
  bestCombo: number;
  holes: number;
  powers: number;
  slices: number[];
  fancy: number[];
  /** Game time when the 10th fancy mouse fell, if it did. */
  dailyAtMs: number | null;
}

export interface LawnProgress {
  open: number;
  total: number;
  /** ms until the next hole opens, or null when the lawn is full */
  nextInMs: number | null;
  /** 0..1 towards the full lawn */
  progress: number;
  speed: number;
}

export interface GameCallbacks {
  onScore(score: number, best: number, points: number): void;
  onTimer(remainingMs: number): void;
  onPower(kind: PowerKind | null, remainingMs: number, totalMs: number): void;
  onLawn(p: LawnProgress): void;
  onNewHole(open: number): void;
  onLick(ms: number, cause: "porcupine" | "snake"): void;
  onGameOver(score: number, best: number, isNewBest: boolean, stats: RoundStats): void;
  onCombo(combo: number, hole: number | null): void;
  onFancy(variant: number, count: number, hole: number): void;
  onEvent(ev: GameEvent): void;
}

export interface GameOptions {
  /** whether the yellow lizard is unlocked (asked at the start of every round) */
  lizard(): boolean;
}

/** Mice, fancy mice and lizards: everything the cat wants to catch. */
function isPrey(c: Critter): boolean {
  return c === "mouse" || c === "fancy" || c === "lizard";
}

export class Game {
  private holes: Hole[] = [];
  private score = 0;
  private points = 0;
  private best = 0;
  private running = false;
  private deadline = 0;
  private readyUntil = 0;
  private stunUntil = 0;
  private nextSpawnAt = 0;
  private nextPowerAt = 0;
  private nextFoeAt = 0;
  private nextSnakeAt = 0;
  private nextLizardAt = Infinity;
  private raf = 0;
  private lastFrame = 0;
  private power: PowerKind | null = null;
  private powerUntil = 0;
  private elapsed = 0;
  private opened = 0;
  private lastSecond = 0;
  private combo = 0;
  private bestCombo = 0;
  private lastCatchAt = 0;
  private powersTaken = 0;
  private slices: number[] = [];
  private plainSinceFancy = 0;
  private fancyCaught: number[] = [];
  private dailyAt: number | null = null;

  constructor(private readonly lawn: Lawn, private readonly cb: GameCallbacks, private readonly opts: GameOptions = { lizard: () => false }) {
    this.best = readBest();
    this.holes = Array.from({ length: HOLES }, () => ({
      open: false, up: false, what: "mouse" as Critter, variant: null, upAt: 0, hideAt: 0, autoAt: 0, busyUntil: 0, hopsLeft: 0, nextBiteAt: 0
    }));
    this.openStartHoles(false);
    lawn.onTap((i) => this.tap(i));
    this.cb.onScore(0, this.best, 0);
    this.cb.onTimer(CATCH_WINDOW_MS);
    this.cb.onPower(null, 0, 0);
    this.cb.onLawn(this.progress());
  }

  get bestScore(): number {
    return this.best;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.reset();
    this.running = true;
    const now = performance.now();
    this.lastFrame = now;
    this.readyUntil = now + GUARD_MS;
    this.deadline = this.readyUntil + CATCH_WINDOW_MS;
    this.nextSpawnAt = this.readyUntil + 150;
    this.nextPowerAt = now + 25000 + Math.random() * 15000;
    this.nextFoeAt = now + 9000 + Math.random() * 6000;
    this.nextSnakeAt = now + 38000 + Math.random() * 8000;
    this.nextLizardAt = this.opts.lizard() ? now + LIZARD_FIRST_MS + Math.random() * 4000 : Infinity;
    this.lawn.cat(1, "idle");
    cancelAnimationFrame(this.raf);
    this.cb.onEvent({ type: "start" });
    this.raf = requestAnimationFrame(this.tick);
  }

  private reset(): void {
    this.score = 0;
    this.points = 0;
    this.elapsed = 0;
    this.lastSecond = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.lastCatchAt = 0;
    this.powersTaken = 0;
    this.slices = [];
    this.plainSinceFancy = 0;
    this.fancyCaught = [];
    this.dailyAt = null;
    this.stunUntil = 0;
    this.setPower(null);
    for (const h of this.holes) {
      h.up = false;
      h.busyUntil = 0;
    }
    this.lawn.clear();
    this.openStartHoles(true);
    this.cb.onScore(0, this.best, 0);
    this.cb.onTimer(CATCH_WINDOW_MS);
    this.cb.onLawn(this.progress());
  }

  private openStartHoles(animate: boolean): void {
    this.opened = START_HOLES.length;
    this.holes.forEach((h, i) => (h.open = START_HOLES.includes(i)));
    this.lawn.setActive(START_HOLES, animate);
  }

  // Pace grows smoothly with game time: ~10% faster every 30 s, then every 15 s once the lawn is full.
  private speed(): number {
    const e = this.elapsed;
    const steps = e <= FULL_LAWN_MS ? e / 30000 : FULL_LAWN_MS / 30000 + (e - FULL_LAWN_MS) / 15000;
    return Math.pow(1.1, steps);
  }
  private upTime(): number {
    return clamp(1600 / this.speed(), 450, 1600);
  }
  private spawnGap(): number {
    return clamp(800 / this.speed(), 220, 800);
  }
  private simultaneous(): number {
    const base = this.opened < 5 ? 1 : this.opened < 13 ? 2 : 3;
    const late = Math.floor(Math.max(0, this.elapsed - FULL_LAWN_MS - 15000) / 30000);
    return Math.min(5, base + late);
  }

  private progress(): LawnProgress {
    const idx = this.opened - START_HOLES.length;
    const next = HOLE_TIMES[idx];
    return {
      open: this.opened,
      total: HOLES,
      nextInMs: next === undefined ? null : Math.max(0, next - this.elapsed),
      progress: Math.min(1, this.elapsed / FULL_LAWN_MS),
      speed: this.speed()
    };
  }

  // Dig the next hole when its time comes; warn a moment before.
  private growLawn(): void {
    const idx = this.opened - START_HOLES.length;
    const at = HOLE_TIMES[idx];
    if (at === undefined) return;
    const hole = HOLE_ORDER[this.opened]!;
    if (this.elapsed >= at - TELEGRAPH_MS && this.elapsed < at) this.lawn.telegraph(hole, at - this.elapsed);
    if (this.elapsed >= at) {
      this.opened += 1;
      this.holes[hole]!.open = true;
      this.lawn.setActive(this.holes.flatMap((h, i) => (h.open ? [i] : [])));
      sfx.dig();
      this.cb.onNewHole(this.opened);
    }
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = now - this.lastFrame;
    this.lastFrame = now;

    // Get-ready grace and Freeze both stop the clock; nothing moves or comes out.
    const frozen = this.power === "freeze" || now < this.readyUntil;
    if (frozen) {
      this.deadline += dt;
      this.nextSpawnAt += dt;
      this.nextFoeAt += dt;
      this.nextSnakeAt += dt;
      this.nextPowerAt += dt;
      this.nextLizardAt += dt;
      for (const h of this.holes) {
        if (!h.up) continue;
        h.hideAt += dt;
        h.upAt += dt;
        h.nextBiteAt += dt;
      }
    }

    if (!frozen) {
      this.elapsed += dt;
      this.growLawn();
      const second = Math.floor(this.elapsed / 1000);
      if (second !== this.lastSecond) {
        this.lastSecond = second;
        this.cb.onEvent({ type: "time", elapsed: this.elapsed });
      }
    }
    this.cb.onLawn(this.progress());

    if (this.power && now >= this.powerUntil) this.setPower(null);
    if (this.power) this.cb.onPower(this.power, this.powerUntil - now, POWER_DURATION[this.power]);

    const remaining = this.deadline - now;
    this.cb.onTimer(Math.min(CATCH_WINDOW_MS, Math.max(0, remaining)));
    if (remaining <= 0) {
      this.end();
      return;
    }

    if (!frozen) this.updateHoles(now);

    if (!frozen && now >= this.nextSpawnAt) {
      const upMice = this.holes.filter((h) => h.up && h.what === "mouse").length;
      if (upMice < this.simultaneous()) this.spawn(now, "mouse");
      this.nextSpawnAt = now + this.spawnGap() * (0.7 + Math.random() * 0.6);
    }

    // A porcupine pokes its head out now and then.
    if (!frozen && now >= this.nextFoeAt) {
      if (!this.holes.some((h) => h.up && h.what === "porcupine")) this.spawn(now, "porcupine");
      this.nextFoeAt = now + 10000 + Math.random() * 8000;
    }

    // The snake needs neighbours to be dangerous, so it waits for a bigger lawn.
    if (!frozen && now >= this.nextSnakeAt) {
      if (this.opened >= 9 && !this.holes.some((h) => h.up && h.what === "snake")) this.spawn(now, "snake");
      this.nextSnakeAt = now + 20000 + Math.random() * 10000;
    }

    // The lizard darts out every 9-14 s once there is room for it.
    if (!frozen && now >= this.nextLizardAt) {
      if (this.opened >= 6 && !this.holes.some((h) => h.up && h.what === "lizard")) this.spawn(now, "lizard");
      this.nextLizardAt = now + 9000 + Math.random() * 5000;
    }

    // Power-ups show up now and then, never while one is already up or running.
    if (!frozen && now >= this.nextPowerAt) {
      const powerUp = this.holes.some((h) => h.up && isPower(h.what));
      if (!powerUp && !this.power) this.spawn(now, POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)]!);
      this.nextPowerAt = now + 30000 + Math.random() * 20000;
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private updateHoles(now: number): void {
    this.holes.forEach((h, i) => {
      if (!h.up) return;
      const edible = isPrey(h.what);
      if (edible && this.power === "auto" && now >= h.autoAt) {
        this.lawn.slap(i, 1, "catch", "");
        this.catchMouse(i, h);
        return;
      }
      if (h.what === "snake" && now >= h.nextBiteAt) this.snakeBite(i, h, now);
      if (now < h.hideAt) return;
      if (h.what === "fancy" && h.hopsLeft > 0) {
        this.hop(i, h, now);
        return;
      }
      this.lower(i);
      if (edible) this.escaped(i);
    });
  }

  // The snake gulps any mouse standing right beside it (after a short grace so you can race it).
  private snakeBite(i: number, snake: Hole, now: number): void {
    for (const n of neighbours(i)) {
      const v = this.holes[n]!;
      if (!v.up || !isPrey(v.what) || now - v.upAt < 750) continue;
      const fancy = v.what === "fancy";
      v.up = false;
      v.busyUntil = now + 450;
      this.lawn.eat(i, n);
      sfx.gulp();
      snake.nextBiteAt = now + 1200;
      this.cb.onEvent({ type: "eaten", fancy });
      return;
    }
  }

  private hop(from: number, h: Hole, now: number): void {
    const free = this.freeHoles(now).filter((i) => i !== from);
    if (!free.length) {
      h.hideAt = now + 400;
      return;
    }
    const to = free[Math.floor(Math.random() * free.length)]!;
    const t = this.holes[to]!;
    Object.assign(t, {
      up: true, what: "fancy", variant: h.variant, upAt: now + 300, hideAt: now + 300 + this.fancyStay(),
      autoAt: now + 440, hopsLeft: h.hopsLeft - 1, busyUntil: 0
    });
    h.up = false;
    h.busyUntil = now + 300;
    this.lawn.hop(from, to);
    sfx.hop();
  }

  private fancyStay(): number {
    return clamp(1050 / this.speed(), 650, 1050);
  }

  private freeHoles(now: number): number[] {
    const out: number[] = [];
    this.holes.forEach((h, i) => {
      if (h.open && !h.up && now >= h.busyUntil) out.push(i);
    });
    return out;
  }

  private spawn(now: number, what: Critter, variant: number | null = null): void {
    const free = this.freeHoles(now);
    if (!free.length) return;
    const i = free[Math.floor(Math.random() * free.length)]!;
    const hole = this.holes[i]!;
    hole.up = true;
    hole.what = what;
    hole.variant = variant;
    hole.upAt = now;
    hole.hopsLeft = 0;
    if (what === "mouse") {
      hole.hideAt = now + this.upTime() * (0.8 + Math.random() * 0.4);
      hole.autoAt = now + 140;
      sfx.squeak();
    } else if (what === "fancy") {
      hole.hideAt = now + this.fancyStay() + 250;
      hole.autoAt = now + 200;
      hole.hopsLeft = 4 + Math.floor(Math.random() * 3);
      sfx.fancy();
    } else if (what === "lizard") {
      // quick: it barely stops before diving back in
      hole.hideAt = now + clamp(1150 / this.speed(), 600, 1150);
      hole.autoAt = now + 160;
      sfx.squeak();
    } else if (what === "porcupine") {
      hole.hideAt = now + 2200;
      sfx.grunt();
    } else if (what === "snake") {
      hole.hideAt = now + 4800;
      hole.nextBiteAt = now + 1100;
      sfx.hiss();
    } else {
      hole.hideAt = now + 2600;
      sfx.powerUp();
    }
    this.lawn.raise(i, what, variant);
  }

  private lower(i: number): void {
    const h = this.holes[i]!;
    h.up = false;
    h.busyUntil = performance.now() + 250;
    this.lawn.lower(i);
  }

  // A mouse went back down uncaught: the cat is not amused.
  private escaped(i: number): void {
    this.lawn.escape(i);
    this.lawn.cat(1, "angry", 650);
    this.breakCombo();
    this.cb.onEvent({ type: "escape" });
  }

  private setPower(kind: PowerKind | null): void {
    this.power = kind;
    this.powerUntil = kind ? performance.now() + POWER_DURATION[kind] : 0;
    this.lawn.setMood(kind === "freeze" || kind === "auto" ? kind : "");
    this.cb.onPower(kind, kind ? POWER_DURATION[kind] : 0, kind ? POWER_DURATION[kind] : 0);
  }

  private tap(i: number): void {
    if (!this.running) return;
    sfx.unlock();
    const now = performance.now();
    if (now < this.readyUntil) return;
    if (now < this.stunUntil) {
      this.lawn.pop(i, "licking…", "lick");
      return;
    }
    const hole = this.holes[i]!;
    if (!hole.open) return;
    if (!hole.up) {
      this.whiff(i);
      return;
    }
    if (isPrey(hole.what)) {
      this.lawn.slap(i, 1, "catch", "");
      this.catchMouse(i, hole);
    } else if (hole.what === "porcupine") {
      this.hurt(i, "porcupine");
    } else if (hole.what === "snake") {
      this.hurt(i, "snake");
    } else {
      this.collect(i, hole, hole.what as PowerKind);
    }
  }

  private whiff(i: number): void {
    sfx.miss();
    this.deadline -= MISS_PENALTY_MS;
    this.lawn.slap(i, 1, "whiff", `−${(MISS_PENALTY_MS / 1000).toFixed(1)}s`);
    this.lawn.cat(1, "angry", 450);
    this.breakCombo();
    this.cb.onEvent({ type: "whiff" });
  }

  // Ouch: the critter stays put and the cat sits out, licking its paw.
  private hurt(i: number, cause: "porcupine" | "snake"): void {
    const ms = cause === "snake" ? SNAKE_LICK_MS : PORCUPINE_LICK_MS;
    sfx.ouch();
    this.stunUntil = performance.now() + ms;
    this.lawn.slap(i, 1, cause === "snake" ? "bite" : "prick", cause === "snake" ? "Chomp!" : "Ouch!");
    window.setTimeout(() => {
      if (this.running) this.lawn.lick(1, ms - 300);
    }, 300);
    window.setTimeout(() => {
      if (this.running) sfx.lick();
    }, 500);
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    this.breakCombo();
    this.cb.onLick(ms, cause);
    this.cb.onEvent({ type: cause === "snake" ? "bite" : "prick" });
  }

  private catchMouse(i: number, hole: Hole): void {
    const now = performance.now();
    const fancy = hole.what === "fancy";
    const lizard = hole.what === "lizard";
    const worth = lizard ? LIZARD_VALUE : 1;
    hole.up = false;
    hole.busyUntil = now + 450;
    this.combo = now - this.lastCatchAt <= COMBO_WINDOW_MS ? this.combo + 1 : 1;
    this.lastCatchAt = now;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const mult = 1 + Math.min(4, Math.floor(this.combo / 5)) * 0.5;
    const gained = Math.round((fancy ? 100 : 10 * worth) * mult);
    this.points += gained;
    const label = fancy ? `+${gained}` : this.combo >= 3 ? `+${worth} ×${this.combo}` : `+${worth}`;
    window.setTimeout(() => this.lawn.pop(i, label, fancy || lizard ? "fancy" : "catch"), 160);

    this.score += worth;
    // an empty lawn right after a catch feels dead: bring the next mouse out quickly
    if (!this.holes.some((h) => h.up && (h.what === "mouse" || h.what === "fancy"))) {
      this.nextSpawnAt = Math.min(this.nextSpawnAt, now + 220 + Math.random() * 160);
    }
    const slice = Math.floor(this.elapsed / SLICE_MS);
    while (this.slices.length <= slice) this.slices.push(0);
    this.slices[slice]! += worth;
    this.deadline = Math.min(this.deadline + CATCH_BONUS_MS * (fancy ? 2 : 1), now + CATCH_WINDOW_MS);
    this.lawn.cat(1, "catch", 900);
    sfx.catch(this.combo);
    if (navigator.vibrate) navigator.vibrate(fancy ? [12, 30, 12] : 12);

    if (fancy) {
      const variant = hole.variant ?? 0;
      this.fancyCaught.push(variant);
      if (this.fancyCaught.length === DAILY_GOAL && this.dailyAt === null) this.dailyAt = this.elapsed;
      sfx.fancyCatch();
      this.cb.onFancy(variant, this.fancyCaught.length, i);
      this.cb.onEvent({ type: "fancy", variant, count: this.fancyCaught.length, elapsed: this.elapsed });
    } else if (!lizard && this.fancyCaught.length < DAILY_GOAL) {
      this.plainSinceFancy += 1;
      // every 10th plain catch calls out a fancy mouse (if one isn't already hopping around),
      // until the round has the day's 10
      if (this.plainSinceFancy >= FANCY_EVERY && !this.holes.some((h) => h.up && h.what === "fancy")) {
        this.plainSinceFancy = 0;
        window.setTimeout(() => {
          if (this.running && this.fancyCaught.length < DAILY_GOAL) this.spawn(performance.now(), "fancy", dailyVariant());
        }, 350);
      }
    }
    this.cb.onScore(this.score, Math.max(this.best, this.score), this.points);
    this.cb.onCombo(this.combo, i);
    this.cb.onEvent({ type: "catch", score: this.score, combo: this.combo, lizard });
  }

  private collect(i: number, hole: Hole, kind: PowerKind): void {
    hole.up = false;
    hole.busyUntil = performance.now() + 450;
    this.lawn.slap(i, 1, "collect", POWER_LABEL[kind]);
    sfx.powerCollect();
    this.powersTaken += 1;
    if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
    this.cb.onEvent({ type: "power", kind });
    if (kind === "fulltime") {
      this.deadline = performance.now() + CATCH_WINDOW_MS;
      this.cb.onPower("fulltime", 0, 0);
      this.setPower(null);
      return;
    }
    this.setPower(kind);
  }

  private breakCombo(): void {
    if (this.combo) this.cb.onCombo(0, null);
    this.combo = 0;
  }

  private end(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.setPower(null);
    this.holes.forEach((h, i) => {
      if (h.up) this.lawn.lower(i);
      h.up = false;
    });
    this.lawn.cat(1, "sad");
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      writeBest(this.best);
    }
    sfx.over();
    if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    const slices = this.slices.slice();
    const played = Math.max(1, Math.ceil(this.elapsed / SLICE_MS));
    while (slices.length < played) slices.push(0);
    this.cb.onCombo(0, null);
    this.cb.onGameOver(this.score, this.best, isNewBest, {
      score: this.score,
      points: this.points,
      elapsedMs: this.elapsed,
      bestCombo: this.bestCombo,
      holes: this.opened,
      powers: this.powersTaken,
      slices,
      fancy: this.fancyCaught.slice(),
      dailyAtMs: this.dailyAt
    });
  }
}

function isPower(c: Critter): c is PowerKind {
  return c === "auto" || c === "fulltime" || c === "freeze";
}

// Middle first, then outwards ring by ring (ties shuffled once per page load).
function holeOrder(): number[] {
  const rest: { i: number; d: number; r: number }[] = [];
  for (let i = 0; i < HOLES; i++) {
    if (START_HOLES.includes(i)) continue;
    const r = Math.floor(i / 5) - 2;
    const c = (i % 5) - 2;
    rest.push({ i, d: r * r + c * c, r: Math.random() });
  }
  rest.sort((a, b) => a.d - b.d || a.r - b.r);
  return [...START_HOLES, ...rest.map((x) => x.i)];
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

import { sfx } from "./sound";

export const CATCH_WINDOW_MS = 5000;
// Each catch buys a little time back instead of refilling the whole window.
export const CATCH_BONUS_MS = 800;
// Slapping an empty hole costs time.
export const MISS_PENALTY_MS = 300;
export const GRID = 5;
const HOLE_COUNT = GRID * GRID;
const BEST_KEY = "tilcayo.best";

export type PowerKind = "auto" | "fulltime" | "freeze";
export const POWER_DURATION: Record<PowerKind, number> = { auto: 6000, fulltime: 0, freeze: 4000 };
export const POWER_LABEL: Record<PowerKind, string> = { auto: "Auto-catch", fulltime: "Full time", freeze: "Freeze" };
const POWER_KINDS: PowerKind[] = ["auto", "fulltime", "freeze"];

type Occupant = "mouse" | PowerKind;

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
  private raf = 0;
  private lastFrame = 0;
  private lastAlertAt = 0;
  private catTimer = 0;
  private power: PowerKind | null = null;
  private powerUntil = 0;

  constructor(
    private readonly holesEl: HTMLElement,
    private readonly catEl: HTMLElement,
    private readonly cb: GameCallbacks
  ) {
    this.best = readBest();
    this.buildHoles();
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
    this.catEl.classList.remove("is-sad");
    this.catEl.classList.add("is-idle");
    this.setCat("idle");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private reset(): void {
    this.score = 0;
    this.setPower(null);
    for (const h of this.holes) this.lower(h);
    this.cb.onScore(0, this.best);
    this.cb.onTimer(CATCH_WINDOW_MS);
  }

  private buildHoles(): void {
    this.holesEl.replaceChildren();
    this.holesEl.style.setProperty("--grid", String(GRID));
    for (let i = 0; i < HOLE_COUNT; i++) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hole";
      el.setAttribute("aria-label", `Mouse hole ${i + 1}`);
      el.innerHTML =
        `<span class="hole__back"></span>` +
        `<span class="hole__clip">` +
        `<span class="hole__mouse">${MOUSE_IMG}</span>` +
        `<span class="hole__power"><span class="hole__power-img"></span></span>` +
        `</span>` +
        `<span class="hole__front"></span>` +
        `<span class="hole__flash" aria-hidden="true"></span>` +
        `<span class="hole__pawshadow" aria-hidden="true"></span>` +
        `<span class="hole__paw" aria-hidden="true">${PAW_IMG}</span>` +
        `<span class="hole__pop" aria-hidden="true">+1</span>`;
      const hole: Hole = { el, up: false, what: "mouse", hideAt: 0, autoAt: 0 };
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this.tap(hole);
      });
      this.holes.push(hole);
      this.holesEl.append(el);
    }
  }

  // Difficulty curve: a gentle ramp. Mice stay up a little less and appear a little
  // more often as the score grows; the floor is only reached after ~100 catches.
  private upTime(): number {
    return clamp(1700 - this.score * 8, 800, 1700);
  }
  private spawnGap(): number {
    return clamp(750 - this.score * 5, 360, 750);
  }
  private simultaneous(): number {
    if (this.score >= 120) return 5;
    if (this.score >= 70) return 4;
    if (this.score >= 30) return 3;
    return 2;
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
      for (const h of this.holes) if (h.up) h.hideAt += dt;
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

  // Paw slap + floating label on a hole; extra classes drive the variant.
  private burst(hole: Hole, classes: string, label: string, ms: number): void {
    const list = classes.split(" ");
    hole.el.classList.remove("is-hit", ...list);
    void hole.el.offsetWidth;
    hole.el.querySelector(".hole__pop")!.textContent = label;
    hole.el.classList.add("is-hit", ...list);
    setTimeout(() => hole.el.classList.remove("is-hit", ...list), ms);
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

const MOUSE_IMG =
  `<picture><source srcset="/img/mouse.webp" type="image/webp">` +
  `<img src="/img/mouse.png" alt="" width="420" height="645" draggable="false" decoding="async"></picture>`;

const PAW_IMG =
  `<picture><source srcset="/img/paw.webp" type="image/webp">` +
  `<img src="/img/paw.png" alt="" width="520" height="612" draggable="false" decoding="async"></picture>`;

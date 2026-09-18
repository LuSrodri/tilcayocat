import { sfx } from "./sound";

export const CATCH_WINDOW_MS = 5000;
const HOLE_COUNT = 9;
const BEST_KEY = "tilcayo.best";

interface Hole {
  el: HTMLButtonElement;
  up: boolean;
  hideAt: number;
}

export interface GameCallbacks {
  onScore(score: number, best: number): void;
  onTimer(remainingMs: number): void;
  onGameOver(score: number, best: number, isNewBest: boolean): void;
}

export class Game {
  private holes: Hole[] = [];
  private score = 0;
  private best = 0;
  private running = false;
  private deadline = 0;
  private nextSpawnAt = 0;
  private raf = 0;
  private lastAlertAt = 0;

  constructor(
    private readonly holesEl: HTMLElement,
    private readonly catEl: HTMLElement,
    private readonly mouseSvg: string,
    private readonly cb: GameCallbacks
  ) {
    this.best = readBest();
    this.buildHoles();
    this.catEl.classList.add("is-idle");
    this.cb.onScore(0, this.best);
    this.cb.onTimer(CATCH_WINDOW_MS);
  }

  get bestScore(): number {
    return this.best;
  }

  start(): void {
    this.reset();
    this.running = true;
    const now = performance.now();
    this.deadline = now + CATCH_WINDOW_MS;
    this.nextSpawnAt = now + 350;
    this.catEl.classList.remove("is-sad");
    this.catEl.classList.add("is-idle");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  private reset(): void {
    this.score = 0;
    for (const h of this.holes) this.lower(h);
    this.cb.onScore(0, this.best);
    this.cb.onTimer(CATCH_WINDOW_MS);
  }

  private buildHoles(): void {
    this.holesEl.replaceChildren();
    for (let i = 0; i < HOLE_COUNT; i++) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "hole";
      el.setAttribute("aria-label", `Mouse hole ${i + 1}`);
      el.innerHTML =
        `<span class="hole__back"></span>` +
        `<span class="hole__clip"><span class="hole__mouse">${this.mouseSvg}</span></span>` +
        `<span class="hole__front"></span>` +
        `<span class="hole__paw" aria-hidden="true">${PAW_SVG}</span>` +
        `<span class="hole__pop" aria-hidden="true">+1</span>`;
      const hole: Hole = { el, up: false, hideAt: 0 };
      el.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this.tap(hole);
      });
      this.holes.push(hole);
      this.holesEl.append(el);
    }
  }

  // Difficulty curve: mice stay up for less time and appear more often as the score grows.
  private upTime(): number {
    return clamp(1500 - this.score * 28, 620, 1500);
  }
  private spawnGap(): number {
    return clamp(1100 - this.score * 30, 380, 1100);
  }
  private simultaneous(): number {
    if (this.score >= 40) return 3;
    if (this.score >= 15) return 2;
    return 1;
  }

  private tick = (now: number): void => {
    if (!this.running) return;

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
      if (h.up && now >= h.hideAt) this.lower(h);
    }

    if (now >= this.nextSpawnAt) {
      const upCount = this.holes.filter((h) => h.up).length;
      if (upCount < this.simultaneous()) this.spawn(now);
      this.nextSpawnAt = now + this.spawnGap() * (0.7 + Math.random() * 0.6);
    }

    this.raf = requestAnimationFrame(this.tick);
  };

  private spawn(now: number): void {
    const free = this.holes.filter((h) => !h.up && !h.el.classList.contains("is-caught"));
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)]!;
    hole.up = true;
    hole.hideAt = now + this.upTime() * (0.8 + Math.random() * 0.4);
    hole.el.classList.add("is-up");
    sfx.squeak();
  }

  private lower(hole: Hole): void {
    hole.up = false;
    hole.el.classList.remove("is-up");
  }

  private tap(hole: Hole): void {
    if (!this.running) return;
    sfx.unlock();
    if (!hole.up) {
      sfx.miss();
      return;
    }
    hole.up = false;
    hole.el.classList.remove("is-up");
    hole.el.classList.add("is-caught", "is-hit");
    // keep the caught hole busy briefly so a new mouse doesn't instantly reuse it
    setTimeout(() => hole.el.classList.remove("is-caught", "is-hit"), 550);

    this.score += 1;
    this.deadline = performance.now() + CATCH_WINDOW_MS;
    this.catEl.classList.remove("is-alert");
    this.catEl.classList.remove("is-pounce");
    void this.catEl.offsetWidth; // restart animation
    this.catEl.classList.add("is-pounce");
    sfx.catch();
    if (navigator.vibrate) navigator.vibrate(12);
    this.cb.onScore(this.score, Math.max(this.best, this.score));
  }

  private end(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    for (const h of this.holes) this.lower(h);
    this.catEl.classList.remove("is-idle", "is-alert");
    this.catEl.classList.add("is-sad");
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

const PAW_SVG =
  `<svg viewBox="0 0 100 100" aria-hidden="true">` +
  `<g fill="#c8743a" stroke="#1e1410" stroke-width="3">` +
  `<ellipse cx="50" cy="64" rx="24" ry="19"/>` +
  `<ellipse cx="22" cy="42" rx="9" ry="11" transform="rotate(-18 22 42)"/>` +
  `<ellipse cx="40" cy="28" rx="9" ry="11"/>` +
  `<ellipse cx="60" cy="28" rx="9" ry="11"/>` +
  `<ellipse cx="78" cy="42" rx="9" ry="11" transform="rotate(18 78 42)"/>` +
  `</g></svg>`;

// Google Analytics 4 events. The gtag snippet sits in every page's <head>; when it is blocked
// (ad blockers, CSP, offline) these calls simply do nothing.

const GA_ID = "G-F66DVGWFBE";

type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]): void {
  const g = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof g === "function") g(...args);
}

export function track(event: string, params: Record<string, unknown> = {}): void {
  gtag("event", event, params);
}

/** Average frames per second over a stretch of play. Gaps of a second or more (a hidden tab) don't count. */
export class FpsMeter {
  private raf = 0;
  private frames = 0;
  private ms = 0;
  private last = 0;

  /** Does nothing if already measuring, so a resync mid-match keeps the running average. */
  start(): void {
    if (this.raf) return;
    this.frames = 0;
    this.ms = 0;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): number {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    return this.ms > 0 ? (this.frames * 1000) / this.ms : 0;
  }

  private tick = (now: number): void => {
    const dt = now - this.last;
    this.last = now;
    if (dt < 1000) {
      this.frames++;
      this.ms += dt;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

/** Tie every later event to the player's account id (the Supabase user id), anonymous or not. */
export function setUserId(id: string | null): void {
  gtag("config", GA_ID, { user_id: id ?? undefined, send_page_view: false });
}

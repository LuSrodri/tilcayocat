import { DAILY_GOAL, type RoundStats } from "./game";
import { dailyNumber, dailyVariant, fancyKind } from "./fancy";
import { rankFor, challengeUrl } from "./rank";

export { dailyNumber, dailyVariant };

// Daily Challenge: catch 10 of today's fancy mouse in a single round. The count lives inside the
// round, so every new round starts from zero; the best round of the day is kept for the share
// text, Wordle-style. Once a round gets the 10, the mouse of the day stays away until tomorrow.
// Everything is local to the device.

const DAILY_KEY = "tilcayo.daily";

export interface DailyRun {
  fancy: number;
  points: number;
  elapsedMs: number;
  /** time to the 10th fancy mouse, when it happened */
  doneMs: number | null;
}

export interface DailyState {
  date: string;
  best: DailyRun | null;
  done: boolean;
  rounds: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dailyState(): DailyState {
  const date = todayKey();
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY) ?? "null") as DailyState | null;
    if (raw && raw.date === date) return raw;
  } catch {
    /* storage unavailable or corrupt */
  }
  return { date, best: null, done: false, rounds: 0 };
}

function better(a: DailyRun, b: DailyRun | null): boolean {
  if (!b) return true;
  if (a.doneMs !== null && b.doneMs !== null) return a.doneMs < b.doneMs;
  if (a.doneMs !== null) return true;
  if (b.doneMs !== null) return false;
  return a.fancy > b.fancy || (a.fancy === b.fancy && a.points > b.points);
}

export function runOf(stats: RoundStats): DailyRun {
  return { fancy: stats.fancy.length, points: stats.points, elapsedMs: stats.elapsedMs, doneMs: stats.dailyAtMs };
}

/** Fold a finished round into today's record. */
export function recordDaily(stats: RoundStats): { state: DailyState; justDone: boolean } {
  const state = dailyState();
  const run = runOf(stats);
  const wasDone = state.done;
  state.rounds += 1;
  if (better(run, state.best)) state.best = run;
  state.done = state.done || run.doneMs !== null;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  return { state, justDone: state.done && !wasDone };
}

export function formatSeconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * The share text, Wordle-style: the round's catch and rank, one square per mouse of the day
 * towards today's goal, the time, and a link that dares friends to beat the score.
 */
export function dailyShareText(run: DailyRun, mice: number): string {
  const caught = Math.min(DAILY_GOAL, run.fancy);
  const squares = "🐭".repeat(caught) + "⬛".repeat(DAILY_GOAL - caught);
  const done = run.doneMs !== null;
  const rank = rankFor(mice);
  return (
    `🐱 Cat The Mouse Company · Day #${dailyNumber()}\n` +
    `${rank.emoji} ${mice} ${mice === 1 ? "mouse" : "mice"} · ${rank.name} · ${run.points.toLocaleString("en-US")} pts\n` +
    `${squares}\n` +
    `🎩 ${caught}/${DAILY_GOAL} ${fancyKind(dailyVariant()).name}${done ? " ✅" : ""} · ⏱️ ${formatSeconds(done ? run.doneMs! : run.elapsedMs)}\n` +
    `Can your cat beat mine? ${challengeUrl(mice).replace("https://", "")}`
  );
}

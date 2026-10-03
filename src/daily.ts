import { DAILY_GOAL, type RoundStats } from "./game";
import { dailyNumber, dailyVariant, fancyKind } from "./fancy";
import { rankFor, challengeUrl } from "./rank";

export { dailyNumber, dailyVariant };

// Daily Challenge: catch 20 of today's fancy mouse. Every round of the day adds to the same count,
// which is saved on each catch so closing the tab mid-round loses nothing. Once the 20 are in, the
// mouse of the day stays away until tomorrow. Everything is local to the device.

const DAILY_KEY = "tilcayo.daily";

export interface DailyState {
  date: string;
  /** mice of the day caught today, across all rounds */
  caught: number;
  done: boolean;
  rounds: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Older saves kept only the best round ({ best: { fancy }, done }); a finished day stays finished.
interface LegacyState {
  date: string;
  best?: { fancy: number } | null;
  done?: boolean;
  rounds?: number;
  caught?: number;
}

export function dailyState(): DailyState {
  const date = todayKey();
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY) ?? "null") as LegacyState | null;
    if (raw && raw.date === date) {
      const done = !!raw.done;
      const caught = raw.caught ?? (done ? DAILY_GOAL : (raw.best?.fancy ?? 0));
      return { date, caught: Math.min(DAILY_GOAL, caught), done: done || caught >= DAILY_GOAL, rounds: raw.rounds ?? 0 };
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { date, caught: 0, done: false, rounds: 0 };
}

function save(state: DailyState): void {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

/** Count one mouse of the day; `justDone` is true on the catch that completes the challenge. */
export function addDailyCatch(): { state: DailyState; justDone: boolean } {
  const state = dailyState();
  if (state.done) return { state, justDone: false };
  state.caught = Math.min(DAILY_GOAL, state.caught + 1);
  state.done = state.caught >= DAILY_GOAL;
  save(state);
  return { state, justDone: state.done };
}

/** Count a finished round. */
export function recordRound(): DailyState {
  const state = dailyState();
  state.rounds += 1;
  save(state);
  return state;
}

export function formatSeconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * The share text, Wordle-style: the round's catch and rank, today's progress towards the daily
 * goal (one square per two mice of the day), the round's time, and a link that dares friends to
 * beat the score.
 */
export function dailyShareText(stats: RoundStats, mice: number): string {
  const { caught, done } = dailyState();
  const filled = Math.floor(caught / 2);
  const squares = "🐭".repeat(filled) + "⬛".repeat(DAILY_GOAL / 2 - filled);
  const rank = rankFor(mice);
  return (
    `🐱 Cat The Mouse Company · Day #${dailyNumber()}\n` +
    `${rank.emoji} ${mice} ${mice === 1 ? "mouse" : "mice"} · ${rank.name} · ${stats.points.toLocaleString("en-US")} pts\n` +
    `${squares}\n` +
    `🎩 ${caught}/${DAILY_GOAL} ${fancyKind(dailyVariant()).name}${done ? " ✅" : ""} · ⏱️ ${formatSeconds(stats.elapsedMs)}\n` +
    `Can your cat beat mine? ${challengeUrl(mice).replace("https://", "")}`
  );
}

// Hunter ranks by mice caught in one round, the daily play streak and friend challenges
// (?beat=N links). Everything here is local to the device, like the best score.

export interface Rank {
  id: string;
  name: string;
  min: number;
  /** badge gradient: highlight → deep */
  tint: [string, string];
  emoji: string;
}

export const RANKS: Rank[] = [
  { id: "kitten", name: "Sleepy Kitten", min: 0, tint: ["#e8e2f5", "#8b93b8"], emoji: "🐾" },
  { id: "cub", name: "Curious Cub", min: 5, tint: ["#c8ffd4", "#2f9e57"], emoji: "🌱" },
  { id: "prowler", name: "Lawn Prowler", min: 12, tint: ["#bff3ff", "#2f6bb3"], emoji: "🌙" },
  { id: "hunter", name: "Night Hunter", min: 20, tint: ["#ffe27a", "#e0641f"], emoji: "🔥" },
  { id: "stalker", name: "Shadow Stalker", min: 30, tint: ["#ffc0e6", "#b02a7a"], emoji: "⚡" },
  { id: "legend", name: "Lawn Legend", min: 45, tint: ["#cffff3", "#0d7a6b"], emoji: "👑" },
  { id: "mythic", name: "Mythic Mouser", min: 65, tint: ["#fff6c9", "#c9851a"], emoji: "🌟" }
];

export function rankFor(score: number): Rank {
  let rank = RANKS[0]!;
  for (const r of RANKS) if (score >= r.min) rank = r;
  return rank;
}

export function nextRank(score: number): Rank | null {
  return RANKS.find((r) => r.min > score) ?? null;
}

// 0..1 progress from the current rank's floor to the next one's.
export function rankProgress(score: number): number {
  const cur = rankFor(score);
  const next = nextRank(score);
  if (!next) return 1;
  return (score - cur.min) / (next.min - cur.min);
}

// ---- daily streak -----------------------------------------------------------

const STREAK_KEY = "tilcayo.streak";

interface StreakState {
  last: string;
  days: number;
}

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readStreak(): StreakState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAK_KEY) ?? "null") as StreakState | null;
    return raw && typeof raw.last === "string" && typeof raw.days === "number" ? raw : null;
  } catch {
    return null;
  }
}

/** Days in a row the player has started a round, counting today only if they already played. */
export function currentStreak(): number {
  const s = readStreak();
  if (!s) return 0;
  return s.last === today() || s.last === today(-1) ? s.days : 0;
}

/** Record a round played today; returns the streak and whether it just grew. */
export function touchStreak(): { days: number; grew: boolean } {
  const s = readStreak();
  const t = today();
  if (s?.last === t) return { days: s.days, grew: false };
  const days = s?.last === today(-1) ? s.days + 1 : 1;
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ last: t, days }));
  } catch {
    /* storage unavailable */
  }
  return { days, grew: days > 1 };
}

// ---- friend challenge -------------------------------------------------------

/** The score a shared link dares you to beat (?beat=42), if any. */
export function challengeTarget(): number | null {
  const raw = new URLSearchParams(location.search).get("beat");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
}

export const SITE = "https://catthemouse.co/";

export function challengeUrl(score: number): string {
  return score > 0 ? `${SITE}?beat=${score}` : SITE;
}

// ---- share text -------------------------------------------------------------

const HEAT = ["⬛", "🟫", "🟨", "🟧", "🟥"];

/** One square per 10 s of the round, coloured by how many mice fell in it (Wordle-style). */
export function heatStrip(slices: number[], max = 12): string {
  let s = slices;
  if (s.length > max) {
    // fold long rounds into `max` buckets so the line fits in a post
    const size = Math.ceil(s.length / max);
    s = Array.from({ length: Math.ceil(s.length / size) }, (_, i) =>
      Math.round(slices.slice(i * size, i * size + size).reduce((a, b) => a + b, 0) / size)
    );
  }
  return s.map((n) => HEAT[n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4]).join("");
}

export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

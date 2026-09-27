// Wire protocol shared by the Worker and the browser client (kept dependency-free).

export const ROUND_MS = 60_000;
export const GRID = 5;
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 5;
export const COUNTDOWN_MS = 3_000;
export const INTERMISSION_MS = 5_000;
// Slapping a porcupine or a snake doesn't cost points any more: the cat sits out, licking its paw.
export const PORCUPINE_LICK_MS = 2000;
export const SNAKE_LICK_MS = 3000;
// Every 10th plain mouse caught on the lawn (by either player) calls out a fancy mouse worth 3.
export const FANCY_EVERY = 10;
export const FANCY_POINTS = 3;
export const FANCY_KINDS = 100;

export type Slot = 1 | 2;

export interface PlayerInfo {
  slot: Slot;
  name: string;
  connected: boolean;
}

export type Critter = "mouse" | "fancy" | "porcupine" | "snake";

export interface MouseInfo {
  id: number;
  hole: number;
  kind: Critter;
  expiresAt: number;
  /** which of the 100 fancy mice (fancy only) */
  variant?: number;
}

/** Holes sharing an edge with `hole` on the GRID×GRID lawn (the snake's reach). */
export function neighbours(hole: number): number[] {
  const r = Math.floor(hole / GRID);
  const c = hole % GRID;
  const out: number[] = [];
  if (r > 0) out.push(hole - GRID);
  if (r < GRID - 1) out.push(hole + GRID);
  if (c > 0) out.push(hole - 1);
  if (c < GRID - 1) out.push(hole + 1);
  return out;
}

// How many people have the game open right now (Presence object).
export interface OnlineCount {
  total: number;
  solo: number;
  duel: number;
}

export interface RoundResult {
  round: number;
  scores: [number, number];
  winner: Slot | 0;
}

export type ServerMessage =
  | { type: "welcome"; you: Slot; code: string; players: PlayerInfo[]; now: number }
  | { type: "players"; players: PlayerInfo[] }
  | { type: "countdown"; round: number; startsAt: number; now: number }
  | { type: "round"; round: number; startsAt: number; endsAt: number; now: number; scores: [number, number]; wins: [number, number] }
  | { type: "spawn"; mouse: MouseInfo; now: number }
  | { type: "hide"; id: number }
  | { type: "catch"; id: number; hole: number; by: Slot; scores: [number, number]; gain: number }
  | { type: "whiff"; hole: number; by: Slot }
  | { type: "ouch"; id: number; hole: number; by: Slot; kind: "porcupine" | "snake"; ms: number }
  | { type: "hop"; id: number; from: number; to: number; expiresAt: number }
  | { type: "eaten"; id: number; hole: number; snakeHole: number }
  | { type: "roundEnd"; result: RoundResult; wins: [number, number]; nextAt: number | null; now: number }
  | { type: "final"; winner: Slot | 0; wins: [number, number]; rounds: RoundResult[]; totals: [number, number]; forfeit: boolean }
  | { type: "full" }
  | { type: "matched"; code: string }
  | { type: "queued" }
  | ({ type: "online" } & OnlineCount)
  | { type: "error"; message: string };

export type ClientMessage = { type: "tap"; hole: number } | { type: "ping" };

export function cleanName(raw: string | null): string {
  const s = (raw ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 14);
  return s || "Tilcayo";
}

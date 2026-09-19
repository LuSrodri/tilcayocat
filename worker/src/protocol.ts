// Wire protocol shared by the Worker and the browser client (kept dependency-free).

export const ROUND_MS = 60_000;
export const GRID = 5;
export const ROUNDS_TO_WIN = 2;
export const MAX_ROUNDS = 5;
export const COUNTDOWN_MS = 3_000;
export const INTERMISSION_MS = 5_000;

export type Slot = 1 | 2;

export interface PlayerInfo {
  slot: Slot;
  name: string;
  connected: boolean;
}

export interface MouseInfo {
  id: number;
  hole: number;
  expiresAt: number;
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
  | { type: "catch"; id: number; hole: number; by: Slot; scores: [number, number] }
  | { type: "whiff"; hole: number; by: Slot }
  | { type: "roundEnd"; result: RoundResult; wins: [number, number]; nextAt: number | null; now: number }
  | { type: "final"; winner: Slot | 0; wins: [number, number]; rounds: RoundResult[]; totals: [number, number]; forfeit: boolean }
  | { type: "full" }
  | { type: "matched"; code: string }
  | { type: "queued" }
  | { type: "error"; message: string };

export type ClientMessage = { type: "tap"; hole: number } | { type: "ping" };

export function cleanName(raw: string | null): string {
  const s = (raw ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 14);
  return s || "Tilcayo";
}

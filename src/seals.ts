import type { GameEvent } from "./game";
import { sfx } from "./sound";
import { albumAdd, albumSize, FANCY_COUNT } from "./fancy";

// Achievement seals: seven wax seals the player collects, one of them only reachable in the 1v1
// arena and one for filling the fancy-mouse album. They live on the device (localStorage), like the best score.
export type SealId = "swift" | "nightwatch" | "clean" | "hoard" | "streak" | "duelist" | "collector";

export interface Seal {
  id: SealId;
  name: string;
  goal: string;
  /** medal gradient: highlight → rim */
  tint: [string, string];
  icon: string;
}

export const SWIFT_MICE = 30;
export const NIGHT_MS = 90_000;
export const CLEAN_MICE = 20;
export const HOARD_POWERS = 6;
export const STREAK_CATCHES = 12;

const PAW_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<ellipse cx="13" cy="15" rx="5" ry="4.1" fill="currentColor"/>` +
  `<circle cx="7.9" cy="10.2" r="2" fill="currentColor"/><circle cx="11.3" cy="7.1" r="2.1" fill="currentColor"/>` +
  `<circle cx="15.5" cy="7.1" r="2.1" fill="currentColor"/><circle cx="18.8" cy="10.2" r="2" fill="currentColor"/>` +
  `<path d="M1.6 13.5h3M2.6 17h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

const MOON_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M21.2 13.6A9.2 9.2 0 1 1 10.6 3a7.2 7.2 0 0 0 10.6 10.6z" fill="currentColor"/>` +
  `<circle cx="17.6" cy="4.4" r="1.2" fill="currentColor"/><circle cx="20.8" cy="8" r=".8" fill="currentColor"/></svg>`;

const SPARK_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M11 2.2l1.9 5.4 5.4 1.9-5.4 1.9L11 16.8 9.1 11.4 3.7 9.5l5.4-1.9z" fill="currentColor"/>` +
  `<path d="M17.6 14.4l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>`;

const BOLT_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M13.6 1.8L5 13.1h4.9L8.6 22.2 18.8 9.8h-5.2z" fill="currentColor"/></svg>`;

const CHAIN_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round">` +
  `<path d="M10 6.5H7.5a5.5 5.5 0 0 0 0 11H10"/><path d="M14 6.5h2.5a5.5 5.5 0 0 1 0 11H14"/><path d="M8.2 12h7.6"/></svg>`;

const CUP_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M6.6 2.8h10.8v4.9a5.4 5.4 0 0 1-10.8 0z" fill="currentColor"/>` +
  `<path d="M6.6 4.4H3.9v1.5A3.8 3.8 0 0 0 7.7 9.7M17.4 4.4h2.7v1.5a3.8 3.8 0 0 1-3.8 3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>` +
  `<path d="M10.9 13h2.2v3.4h-2.2z" fill="currentColor"/>` +
  `<path d="M7.6 20.6h8.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const HAT_ICON =
  `<svg viewBox="0 0 24 24" aria-hidden="true">` +
  `<path d="M7 3.5h10v11H7z" fill="currentColor"/><rect x="2.5" y="14" width="19" height="3.2" rx="1.6" fill="currentColor"/>` +
  `<path d="M7.4 11.4h9.2" stroke="rgba(0,0,0,.35)" stroke-width="2"/>` +
  `<circle cx="8.5" cy="20.4" r="1.3" fill="currentColor"/><circle cx="15.5" cy="20.4" r="1.3" fill="currentColor"/></svg>`;

export const SEALS: Seal[] = [
  { id: "swift", name: "Quick Paws", goal: `${SWIFT_MICE} mice in one round`, tint: ["#ffe27a", "#e0641f"], icon: PAW_ICON },
  { id: "nightwatch", name: "Night Watch", goal: `Survive ${NIGHT_MS / 1000} s`, tint: ["#bff3ff", "#2f6bb3"], icon: MOON_ICON },
  { id: "clean", name: "Clean Paws", goal: `${CLEAN_MICE} catches, no misses`, tint: ["#ffffff", "#8b93b8"], icon: SPARK_ICON },
  { id: "hoard", name: "Power Hoarder", goal: `Grab ${HOARD_POWERS} power-ups`, tint: ["#b6ffd8", "#12a06a"], icon: BOLT_ICON },
  { id: "streak", name: "No Escape", goal: `${STREAK_CATCHES} in a row, no escapes`, tint: ["#ffc0e6", "#b02a7a"], icon: CHAIN_ICON },
  { id: "duelist", name: "Lawn Duelist", goal: "Win a 1v1 online match", tint: ["#cffff3", "#0d7a6b"], icon: CUP_ICON },
  { id: "collector", name: "Mouse Collector", goal: `All ${FANCY_COUNT} mice of the day`, tint: ["#fff0b3", "#b5179e"], icon: HAT_ICON }
];

const EARNED_KEY = "tilcayo.seals";
const POWERS_KEY = "tilcayo.powers";

const earnedIds = readEarned();
let powersTaken = readNumber(POWERS_KEY);
const listeners: ((seal: Seal) => void)[] = [];

export function isEarned(id: SealId): boolean {
  return earnedIds.has(id);
}

export function onSealEarned(fn: (seal: Seal) => void): void {
  listeners.push(fn);
}

// Grant a seal. Already-earned seals are silent, so callers can fire and forget.
export function earn(id: SealId): boolean {
  if (earnedIds.has(id)) return false;
  earnedIds.add(id);
  writeEarned();
  const seal = SEALS.find((s) => s.id === id);
  if (seal) for (const fn of listeners) fn(seal);
  return true;
}

/** A finished Daily Challenge puts its mouse in the album; the full album earns the collector seal. */
export function collectFancy(variant: number): boolean {
  const fresh = albumAdd(variant);
  if (albumSize() >= FANCY_COUNT) earn("collector");
  return fresh;
}

// Draw the shelf: seven medals, locked ones greyed out with their goal as the hint.
export function renderSeals(list: HTMLElement, count?: HTMLElement | null, fresh?: SealId | null): void {
  list.replaceChildren(
    ...SEALS.map((seal) => {
      const li = document.createElement("li");
      li.className = "seal";
      li.dataset.seal = seal.id;
      if (!earnedIds.has(seal.id)) li.classList.add("is-locked");
      if (fresh === seal.id) li.classList.add("is-new");
      li.style.setProperty("--seal", seal.tint[0]);
      li.style.setProperty("--seal-deep", seal.tint[1]);
      li.innerHTML =
        `<span class="seal__medal" aria-hidden="true">${seal.icon}</span>` +
        `<b class="seal__name"></b><small class="seal__goal"></small>`;
      li.querySelector(".seal__name")!.textContent = seal.name;
      li.querySelector(".seal__goal")!.textContent = earnedIds.has(seal.id) ? "Earned" : seal.goal;
      li.title = earnedIds.has(seal.id) ? `${seal.name} — earned: ${seal.goal}` : `${seal.name} — locked: ${seal.goal}`;
      return li;
    })
  );
  if (count) count.textContent = `${earnedIds.size}/${SEALS.length}`;
}

// Draw the shelf and celebrate every seal earned from here on: a toast (the page supplies its
// own), a little fanfare and a fresh stamp on the shelf.
export function mountSeals(list: HTMLElement, count: HTMLElement, toast: (text: string, kind: string) => void): void {
  renderSeals(list, count);
  onSealEarned((seal) => {
    renderSeals(list, count, seal.id);
    toast(`Seal: ${seal.name}`, "seal");
    sfx.seal();
    if (navigator.vibrate) navigator.vibrate([15, 40, 15, 40, 25]);
  });
}

// Round-scoped progress. It is fed the solo game's own events and only ever grants seals.
export class SealTracker {
  private streak = 0;
  private clean = true;

  feed(ev: GameEvent): void {
    switch (ev.type) {
      case "start":
        this.streak = 0;
        this.clean = true;
        break;
      case "catch":
        this.streak += 1;
        if (ev.score >= SWIFT_MICE) earn("swift");
        if (this.clean && ev.score >= CLEAN_MICE) earn("clean");
        if (this.streak >= STREAK_CATCHES) earn("streak");
        break;
      case "escape":
        this.streak = 0;
        break;
      case "whiff":
      case "prick":
      case "bite":
        // an empty slap, a porcupine or a snake spoils the round's clean sheet
        this.clean = false;
        break;
      case "power":
        powersTaken += 1;
        writeNumber(POWERS_KEY, powersTaken);
        if (powersTaken >= HOARD_POWERS) earn("hoard");
        break;
      case "time":
        if (ev.elapsed >= NIGHT_MS) earn("nightwatch");
        break;
    }
  }
}

function readEarned(): Set<SealId> {
  const ids = new Set<SealId>();
  try {
    const raw = JSON.parse(localStorage.getItem(EARNED_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) {
      for (const id of raw) if (SEALS.some((s) => s.id === id)) ids.add(id as SealId);
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return ids;
}

function writeEarned(): void {
  try {
    localStorage.setItem(EARNED_KEY, JSON.stringify([...earnedIds]));
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable */
  }
}

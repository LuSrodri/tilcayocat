// Fancy mice: 100 dressed-up mice (10 hats × 10 accessories). Each day has its own "mouse of the
// day" (the list cycles every 100 days); it is the only fancy mouse that shows up, after every 10
// plain catches, and it hops between holes before it runs off. Catching 20 of it in a day (over any number of rounds) puts
// that mouse in the album; a full album earns the "Mouse Collector" seal.

export const FANCY_COUNT = 100;
export const FANCY_EVERY = 10;

export const HATS = [
  "Magician", "Monarch", "Party Animal", "Snowbird", "Cowpoke",
  "Wizard", "Flower Child", "Chef", "Pirate", "Tinkerer"
] as const;

export const ACCESSORIES = [
  "Dapper", "Posh", "Cool", "Cozy", "Mustachioed",
  "Fancy", "Lovestruck", "Outlaw", "Bookish", "Jingly"
] as const;

// Hat colourways rotate with the accessory so no two variants look alike.
export const PALETTES: [string, string][] = [
  ["#3b2a4a", "#ff6f91"],
  ["#2f5d8a", "#ffd166"],
  ["#8a3b2f", "#9be7c4"],
  ["#2f7a52", "#ffb3c6"],
  ["#6a4c93", "#ffe066"],
  ["#c0392b", "#fdf0d5"],
  ["#1f6f78", "#ffa62b"],
  ["#5c4033", "#8fd3ff"],
  ["#d35d8a", "#fff3b0"],
  ["#264653", "#e9c46a"]
];

export interface FancyKind {
  id: number;
  hat: number;
  acc: number;
  name: string;
  palette: [string, string];
}

export function fancyKind(id: number): FancyKind {
  const i = ((id % FANCY_COUNT) + FANCY_COUNT) % FANCY_COUNT;
  const hat = i % 10;
  const acc = Math.floor(i / 10);
  return { id: i, hat, acc, name: `${ACCESSORIES[acc]} ${HATS[hat]}`, palette: PALETTES[(hat + acc * 3) % PALETTES.length]! };
}

// ---- album -------------------------------------------------------------------

const ALBUM_KEY = "tilcayo.album";
const album = readAlbum();

export function albumHas(id: number): boolean {
  return album.has(id);
}

export function albumSize(): number {
  return album.size;
}

/** Record a caught fancy mouse; returns true when it is a new kind for the album. */
export function albumAdd(id: number): boolean {
  if (album.has(id)) return false;
  album.add(id);
  try {
    localStorage.setItem(ALBUM_KEY, JSON.stringify([...album]));
  } catch {
    /* storage unavailable */
  }
  return true;
}

// Day #1 is launch day (local calendar, like Wordle).
const LAUNCH = new Date(2026, 8, 17);

export function dailyNumber(): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.round((today.getTime() - LAUNCH.getTime()) / 86_400_000) + 1);
}

/** Today's fancy mouse. */
export function dailyVariant(): number {
  return (dailyNumber() - 1) % FANCY_COUNT;
}

function readAlbum(): Set<number> {
  const out = new Set<number>();
  try {
    const raw = JSON.parse(localStorage.getItem(ALBUM_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) for (const n of raw) if (Number.isInteger(n) && n >= 0 && n < FANCY_COUNT) out.add(n as number);
  } catch {
    /* storage unavailable or corrupt */
  }
  return out;
}

// The shop: points earned in rounds (solo and 1v1) buy new cats and a new critter to hunt.
// Everything lives on the device (localStorage), like the best score. Storage keys keep the
// game's original "tilcayo." prefix.

export type SkinId = "grey" | "orange" | "badger" | "black" | "white" | "calico" | "tilcayo";

export interface Skin {
  id: SkinId;
  name: string;
  blurb: string;
  price: number;
  /** swatch for the shop button: coat → accent */
  swatch: [string, string];
}

// Each cat costs more than the one before; the tilcayo, the rare wild one, is the crown jewel.
export const SKINS: Skin[] = [
  { id: "grey", name: "Grey Tabby", blurb: "The founder. Stripes and a big M on the forehead.", price: 0, swatch: ["#9a9ca3", "#4c4f57"] },
  { id: "orange", name: "Orange Tabby", blurb: "Ginger, loud and always hungry.", price: 150_000, swatch: ["#f0a04b", "#b5531b"] },
  { id: "badger", name: "Badger", blurb: "Smoky coat with a bold white blaze.", price: 400_000, swatch: ["#4a4650", "#f4efe6"] },
  { id: "black", name: "Black Cat", blurb: "A shadow with golden eyes. Brings luck to the lawn.", price: 800_000, swatch: ["#2b2830", "#f5c542"] },
  { id: "white", name: "White Cat", blurb: "Snow-white, one blue eye and one gold.", price: 1_400_000, swatch: ["#f7f3ee", "#7fb8ff"] },
  { id: "calico", name: "Calico", blurb: "White with orange and black patches.", price: 2_200_000, swatch: ["#f2e8da", "#e07b2e"] },
  { id: "tilcayo", name: "Tilcayo", blurb: "The wild cat from the Bolivian cloud forest, named in 2026.", price: 4_000_000, swatch: ["#d8883a", "#3b2216"] }
];

export const LIZARD_PRICE = 600_000;
/** A lizard counts as two mice. */
export const LIZARD_VALUE = 2;

const WALLET_KEY = "tilcayo.wallet";
const OWNED_KEY = "tilcayo.owned";
const SKIN_KEY = "tilcayo.skin";
const LIZARD_KEY = "tilcayo.lizard";

export function skinById(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

export function isSkinId(id: unknown): id is SkinId {
  return typeof id === "string" && SKINS.some((s) => s.id === id);
}

export function wallet(): number {
  return Math.max(0, Math.floor(readNumber(WALLET_KEY)));
}

export function earnPoints(points: number): number {
  const total = wallet() + Math.max(0, Math.floor(points));
  write(WALLET_KEY, String(total));
  return total;
}

function owned(): Set<SkinId> {
  const out = new Set<SkinId>(["grey"]);
  try {
    const raw = JSON.parse(localStorage.getItem(OWNED_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) for (const id of raw) if (isSkinId(id)) out.add(id);
  } catch {
    /* storage unavailable or corrupt */
  }
  return out;
}

export function ownsSkin(id: SkinId): boolean {
  return owned().has(id);
}

export function currentSkin(): SkinId {
  let id: string | null = null;
  try {
    id = localStorage.getItem(SKIN_KEY);
  } catch {
    /* ignore */
  }
  return isSkinId(id) && ownsSkin(id) ? id : "grey";
}

export function equipSkin(id: SkinId): boolean {
  if (!ownsSkin(id)) return false;
  write(SKIN_KEY, id);
  return true;
}

/** Spend points on a cat; it is equipped right away. */
export function buySkin(id: SkinId): boolean {
  const skin = skinById(id);
  if (ownsSkin(id) || wallet() < skin.price) return false;
  write(WALLET_KEY, String(wallet() - skin.price));
  const set = owned();
  set.add(id);
  write(OWNED_KEY, JSON.stringify([...set]));
  write(SKIN_KEY, id);
  return true;
}

export function hasLizard(): boolean {
  return readNumber(LIZARD_KEY) === 1;
}

export function buyLizard(): boolean {
  if (hasLizard() || wallet() < LIZARD_PRICE) return false;
  write(WALLET_KEY, String(wallet() - LIZARD_PRICE));
  write(LIZARD_KEY, "1");
  return true;
}

function readNumber(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

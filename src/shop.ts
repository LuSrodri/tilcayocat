// The shop: points earned in rounds (solo and 1v1) buy new cats and a new critter to hunt.
// A guest's progress lives on the device (localStorage, keys keep the game's original "tilcayo."
// prefix). Once a player signs in, their wallet and unlocks belong to the account: the Worker
// stores them and checks every purchase, and this module keeps a cached copy so the game can keep
// reading them synchronously.

import {
  SKIN_PRICES, LIZARD_PRICE as PRICE_OF_LIZARD, MAX_EARN,
  type Inventory, type GuestProgress, type ShopItem
} from "../worker/src/protocol";

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
  { id: "grey", name: "Grey Tabby", blurb: "The founder. Stripes and a big M on the forehead.", price: SKIN_PRICES.grey, swatch: ["#9a9ca3", "#4c4f57"] },
  { id: "orange", name: "Orange Tabby", blurb: "Ginger, loud and always hungry.", price: SKIN_PRICES.orange, swatch: ["#f0a04b", "#b5531b"] },
  { id: "badger", name: "Badger", blurb: "Smoky coat with a bold white blaze.", price: SKIN_PRICES.badger, swatch: ["#4a4650", "#f4efe6"] },
  { id: "black", name: "Black Cat", blurb: "A shadow with golden eyes. Brings luck to the lawn.", price: SKIN_PRICES.black, swatch: ["#2b2830", "#f5c542"] },
  { id: "white", name: "White Cat", blurb: "Snow-white, one blue eye and one gold.", price: SKIN_PRICES.white, swatch: ["#f7f3ee", "#7fb8ff"] },
  { id: "calico", name: "Calico", blurb: "White with orange and black patches.", price: SKIN_PRICES.calico, swatch: ["#f2e8da", "#e07b2e"] },
  { id: "tilcayo", name: "Tilcayo", blurb: "The wild cat from the Bolivian cloud forest, named in 2026.", price: SKIN_PRICES.tilcayo, swatch: ["#d8883a", "#3b2216"] }
];

export const LIZARD_PRICE = PRICE_OF_LIZARD;
/** A lizard counts as two mice. */
export const LIZARD_VALUE = 2;

const WALLET_KEY = "tilcayo.wallet";
const OWNED_KEY = "tilcayo.owned";
const SKIN_KEY = "tilcayo.skin";
const LIZARD_KEY = "tilcayo.lizard";
/** last known inventory of the signed-in account, plus points not yet confirmed by the server */
const ACCOUNT_KEY = "tilcayo.account";

export function skinById(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0]!;
}

export function isSkinId(id: unknown): id is SkinId {
  return typeof id === "string" && SKINS.some((s) => s.id === id);
}

// ---- the signed-in account --------------------------------------------------------------

/** What account.ts plugs in once the player is signed in. Every call returns the new inventory. */
export interface ShopServer {
  earn(points: number, reason: "round" | "duel"): Promise<Inventory>;
  buy(item: ShopItem): Promise<Inventory>;
  equip(skin: SkinId): Promise<Inventory>;
}

interface AccountCache {
  uid: string;
  inv: Inventory;
  /** points earned while offline or before the server answered */
  pending: number;
}

let account: AccountCache | null = readAccount();
let server: ShopServer | null = null;
const listeners = new Set<() => void>();

/** A whole inventory, as the server sends it (a broken one would take the game down with it). */
function isInventory(x: unknown): x is Inventory {
  const inv = x as Inventory | null;
  return !!inv && Number.isFinite(inv.wallet) && Array.isArray(inv.owned) && typeof inv.skin === "string";
}

function readAccount(): AccountCache | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null") as AccountCache | null;
    return raw && typeof raw.uid === "string" && isInventory(raw.inv) && Number.isFinite(raw.pending) ? raw : null;
  } catch {
    return null;
  }
}

function changed(): void {
  if (account) write(ACCOUNT_KEY, JSON.stringify(account));
  for (const l of listeners) l();
}

/** Re-render whenever the wallet or the unlocks change (including answers from the server). */
export function onInventory(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function isAccount(): boolean {
  return account !== null;
}

/** The signed-in player already bought the one-time starter pack. */
export function starterUsed(): boolean {
  return !!account?.inv.starterUsed;
}

/** A signed-in player: from now on the server holds the wallet. */
export function attachAccount(uid: string, inv: Inventory, s: ShopServer): void {
  if (!isInventory(inv)) return;
  const pending = account?.uid === uid ? account.pending : 0;
  account = { uid, inv, pending };
  server = s;
  changed();
  void flush();
}

/** Fresh numbers from the server (keeps unconfirmed points on top). */
export function setInventory(inv: Inventory): void {
  if (!account || !isInventory(inv)) return;
  account.inv = { ...inv, wallet: inv.wallet + account.pending };
  changed();
}

/** Signed out: back to the guest's local progress. */
export function detachAccount(): void {
  if (!account && !server) return;
  account = null;
  server = null;
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
  changed();
}

/** The guest's progress on this device, if there is any worth keeping. */
export function guestProgress(): GuestProgress | null {
  const inv: GuestProgress = { wallet: localWallet(), owned: [...localOwned()], lizard: readNumber(LIZARD_KEY) === 1, skin: localSkin() };
  return inv.wallet > 0 || inv.owned.length > 1 || inv.lizard ? inv : null;
}

/** After the guest's progress moved into the account, it must not be counted twice. */
export function clearGuest(): void {
  for (const k of [WALLET_KEY, OWNED_KEY, SKIN_KEY, LIZARD_KEY]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

// Send points that the server hasn't confirmed yet, a round's worth at a time.
let flushing = false;
async function flush(reason: "round" | "duel" = "round"): Promise<void> {
  if (!account || !server || flushing || account.pending <= 0) return;
  flushing = true;
  try {
    while (account && server && account.pending > 0) {
      const chunk = Math.min(MAX_EARN, account.pending);
      const inv = await server.earn(chunk, reason);
      if (!account) break;
      account.pending -= chunk;
      setInventory(inv);
    }
  } catch {
    /* offline or signed out: retried with the next round */
  } finally {
    flushing = false;
  }
}

// Ask the server, then show what it says (a refused purchase rolls the shop back).
function settle(call: Promise<Inventory> | undefined): void {
  void call?.then(setInventory).catch(() => {
    if (account) changed();
  });
}

// ---- the shop API the game uses ----------------------------------------------------------

export function wallet(): number {
  return account ? account.inv.wallet : localWallet();
}

export function earnPoints(points: number, reason: "round" | "duel" = "round"): number {
  const p = Math.max(0, Math.floor(points));
  if (account) {
    account.pending += p;
    account.inv.wallet += p;
    changed();
    void flush(reason);
    return account.inv.wallet;
  }
  const total = localWallet() + p;
  write(WALLET_KEY, String(total));
  return total;
}

export function ownsSkin(id: SkinId): boolean {
  return account ? account.inv.owned.includes(id) : localOwned().has(id);
}

export function currentSkin(): SkinId {
  if (account) return account.inv.skin;
  return localSkin();
}

export function equipSkin(id: SkinId): boolean {
  if (!ownsSkin(id)) return false;
  if (account) {
    if (!server) return false;
    account.inv.skin = id;
    changed();
    settle(server.equip(id));
    return true;
  }
  write(SKIN_KEY, id);
  return true;
}

/** Spend points on a cat; it is equipped right away. */
export function buySkin(id: SkinId): boolean {
  const skin = skinById(id);
  if (ownsSkin(id) || wallet() < skin.price) return false;
  if (account) {
    // the server checks the price again; shown right away, rolled back if it says no
    if (!server) return false;
    account.inv = { ...account.inv, wallet: account.inv.wallet - skin.price, owned: [...account.inv.owned, id], skin: id };
    changed();
    settle(server.buy(id));
    return true;
  }
  write(WALLET_KEY, String(localWallet() - skin.price));
  const set = localOwned();
  set.add(id);
  write(OWNED_KEY, JSON.stringify([...set]));
  write(SKIN_KEY, id);
  return true;
}

export function hasLizard(): boolean {
  return account ? account.inv.lizard : readNumber(LIZARD_KEY) === 1;
}

export function buyLizard(): boolean {
  if (hasLizard() || wallet() < LIZARD_PRICE) return false;
  if (account) {
    if (!server) return false;
    account.inv = { ...account.inv, wallet: account.inv.wallet - LIZARD_PRICE, lizard: true };
    changed();
    settle(server.buy("lizard"));
    return true;
  }
  write(WALLET_KEY, String(localWallet() - LIZARD_PRICE));
  write(LIZARD_KEY, "1");
  return true;
}

// ---- the guest's local progress ----------------------------------------------------------

function localWallet(): number {
  return Math.max(0, Math.floor(readNumber(WALLET_KEY)));
}

function localOwned(): Set<SkinId> {
  const out = new Set<SkinId>(["grey"]);
  try {
    const raw = JSON.parse(localStorage.getItem(OWNED_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) for (const id of raw) if (isSkinId(id)) out.add(id);
  } catch {
    /* storage unavailable or corrupt */
  }
  return out;
}

function localSkin(): SkinId {
  let id: string | null = null;
  try {
    id = localStorage.getItem(SKIN_KEY);
  } catch {
    /* ignore */
  }
  return isSkinId(id) && localOwned().has(id) ? id : "grey";
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

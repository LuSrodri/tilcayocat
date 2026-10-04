import { createClient, type User } from "@supabase/supabase-js";
import { API } from "./api";
import { setUserId, track } from "./analytics";
import { attachAccount, detachAccount, setInventory, guestProgress, clearGuest, type ShopServer } from "./shop";
import { POINTS_PACKS, type Inventory, type PackId } from "../worker/src/protocol";

// Accounts. Supabase Auth signs players in with e-mail and password (the address must be
// confirmed). Before that, every visitor gets an anonymous session, so analytics follow one id
// from the first round. A signed-in player's wallet and cats live on the server (Worker + D1):
// the guest's progress on this browser is folded into the account the first time, then cleared.

const SUPABASE_URL = "https://ewyigeljgsrebcgjfboi.supabase.co";
const SUPABASE_KEY = "sb_publishable_T5RwnIDOl9yD551QiLXsLw_Xav0vPmA";


const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export interface AccountState {
  /** signed in with a confirmed e-mail (not a guest) */
  member: boolean;
  email: string;
  /** the player followed a password-reset link and should choose a new password */
  recovering: boolean;
}

type Listener = (state: AccountState) => void;
const listeners = new Set<Listener>();
let current: AccountState = { member: false, email: "", recovering: false };
let attachedFor = "";

function isMember(user: User | null | undefined): user is User {
  return !!user && !user.is_anonymous && !!user.email_confirmed_at;
}

function publish(patch: Partial<AccountState>): void {
  current = { ...current, ...patch };
  for (const l of listeners) l(current);
}

export function account(): AccountState {
  return current;
}

export function onAccount(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => listeners.delete(l);
}

// ---- the Worker's account API -------------------------------------------------------

async function api<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first");
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json;
}

const server: ShopServer = {
  earn: (points, reason) => api<Inventory>("/account/earn", { points, reason }),
  buy: (item) => api<Inventory>("/account/buy", { item }),
  equip: (skin) => api<Inventory>("/account/equip", { skin })
};

/** Load the account's inventory (merging this browser's guest progress once) and hand it to the shop. */
async function attach(user: User): Promise<void> {
  if (attachedFor === user.id) return;
  attachedFor = user.id;
  const guest = guestProgress();
  try {
    const inv = await api<Inventory>("/account/sync", { guest });
    if (guest) clearGuest();
    attachAccount(user.id, inv, server);
  } catch (err) {
    attachedFor = "";
    console.warn("account sync failed", err);
  }
}

async function follow(user: User | null): Promise<void> {
  setUserId(user?.id ?? null);
  if (isMember(user)) {
    publish({ member: true, email: user.email ?? "" });
    await attach(user);
  } else {
    attachedFor = "";
    detachAccount();
    publish({ member: false, email: "" });
  }
}

/** Start (or resume) the session: an anonymous one if there is none yet. */
export async function initAccount(): Promise<void> {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") publish({ recovering: true });
    if (event === "SIGNED_IN" && isMember(session?.user)) track("login", { method: "email" });
    // run outside the auth callback (Supabase warns against awaiting inside it)
    setTimeout(() => void follow(session?.user ?? null), 0);
  });
  const { data } = await supabase.auth.getSession();
  if (data.session) await follow(data.session.user);
  else {
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error) console.warn("anonymous sign-in failed", error.message);
    await follow(anon?.user ?? null);
  }
}

export async function refreshInventory(): Promise<void> {
  if (!current.member) return;
  setInventory(await api<Inventory>("/account/sync", {}));
}

// ---- e-mail and password ------------------------------------------------------------

const back = (): string => `${location.origin}/?account=1`;

/** Create an account; Supabase e-mails a confirmation link. */
export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: back() } });
  if (error) throw new Error(error.message);
  track("sign_up", { method: "email" });
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Email not confirmed" ? "Confirm your e-mail first: check your inbox." : error.message);
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: back() });
  if (error) throw new Error(error.message);
}

export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  publish({ recovering: false });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  const { data } = await supabase.auth.signInAnonymously();
  await follow(data?.user ?? null);
}

// ---- the points pack -------------------------------------------------------------------

// Checkout needs the whole window; inside a portal's iframe it opens in a new tab.
function go(url: string): void {
  if (window.top !== window.self) window.open(url, "_blank", "noopener");
  else location.assign(url);
}

const packItem = (id: PackId) => ({ item_id: id, item_name: `${POINTS_PACKS[id].points.toLocaleString("en-US")} points` });

/** Send a signed-in player to Stripe Checkout for a points pack. */
export async function buyPoints(pack: PackId): Promise<void> {
  if (!current.member) throw new Error("Sign in to buy");
  const value = POINTS_PACKS[pack].amountCents / 100;
  track("begin_checkout", { currency: "USD", value, items: [{ ...packItem(pack), price: value, quantity: 1 }] });
  const { url } = await api<{ url: string }>("/checkout", { pack });
  go(url);
}

/** Back from Checkout: wait for the webhook to credit the account, then report the sale. */
export async function confirmPurchase(sessionId: string, timeoutMs = 45_000): Promise<number> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (current.member) {
      const p = await api<{ credited: boolean; pack?: PackId; points?: number; amount_cents?: number; currency?: string }>(`/purchase?session=${encodeURIComponent(sessionId)}`).catch(() => null);
      if (p?.credited) {
        await refreshInventory();
        const value = (p.amount_cents ?? 0) / 100;
        track("purchase", {
          transaction_id: sessionId,
          value,
          currency: (p.currency ?? "usd").toUpperCase(),
          items: [{ ...packItem(p.pack ?? "starter"), price: value, quantity: 1 }]
        });
        return p.points ?? 0;
      }
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return 0;
}

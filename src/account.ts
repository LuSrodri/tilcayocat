import { createClient, type User } from "@supabase/supabase-js";
import { setUserId, track } from "./analytics";
import { earnPoints } from "./shop";

// Accounts (Supabase Auth). Every player gets an anonymous account on the first visit, so their
// id ties analytics and purchases together from the first round. Google is the only real sign-in:
// it is linked to that same account (same id), and buying points requires it. The wallet itself
// still lives on the device; points bought with Stripe are recorded by the server and claimed here.

const SUPABASE_URL = "https://ewyigeljgsrebcgjfboi.supabase.co";
const SUPABASE_KEY = "sb_publishable_T5RwnIDOl9yD551QiLXsLw_Xav0vPmA";

export const POINTS_PACK = { points: 50_000, price: "US$ 3.44" };

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" }
});

export interface AccountState {
  user: User | null;
  google: boolean;
  /** what to call the player: their Google name or e-mail */
  label: string;
}

type Listener = (state: AccountState) => void;
const listeners = new Set<Listener>();
let current: AccountState = { user: null, google: false, label: "" };

function stateOf(user: User | null): AccountState {
  const google = !!user && !user.is_anonymous && !!user.identities?.some((i) => i.provider === "google");
  const meta = user?.user_metadata as { full_name?: string; name?: string } | undefined;
  return { user, google, label: google ? meta?.full_name ?? meta?.name ?? user?.email ?? "Google account" : "" };
}

function publish(user: User | null): void {
  current = stateOf(user);
  setUserId(user?.id ?? null);
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

/** Start (or resume) the session: an anonymous one if there is none yet. */
export async function initAccount(): Promise<void> {
  supabase.auth.onAuthStateChange((event, session) => {
    publish(session?.user ?? null);
    if (event === "SIGNED_IN" && current.google) track("login", { method: "Google" });
  });
  // Linking a Google account that already belongs to another player comes back as an error:
  // sign in to that account instead (its purchases come with it).
  const params = new URLSearchParams(location.search + "&" + location.hash.slice(1));
  if (params.get("error_code") === "identity_already_exists") {
    history.replaceState(null, "", location.pathname);
    await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/?shop=1` } });
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) publish(data.session.user);
  else {
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error) console.warn("anonymous sign-in failed", error.message);
    publish(anon?.user ?? null);
  }
}

// OAuth and Checkout need the whole window; inside a portal's iframe, open them in a new tab.
function go(url: string): void {
  if (window.top !== window.self) window.open(url, "_blank", "noopener");
  else location.assign(url);
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = `${location.origin}/?shop=1`;
  const anonymous = !current.user || current.user.is_anonymous;
  const { data, error } = anonymous
    ? await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } })
    : await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data?.url) throw new Error(error?.message ?? "Google sign-in unavailable");
  go(data.url);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  const { data } = await supabase.auth.signInAnonymously();
  publish(data?.user ?? null);
}

/** Send a Google-signed-in player to Stripe Checkout for the points pack. */
export async function buyPoints(): Promise<void> {
  if (!current.google) throw new Error("Sign in with Google to buy");
  track("begin_checkout", { currency: "USD", value: 3.44, items: [{ item_id: "points_50k", item_name: "50,000 points" }] });
  const { data, error } = await supabase.functions.invoke<{ url: string }>("create-checkout", { body: {} });
  if (error || !data?.url) throw new Error("Checkout is unavailable right now");
  go(data.url);
}

/** Credit every paid, unclaimed purchase to the wallet. Returns the points added. */
export async function claimPoints(): Promise<number> {
  if (!current.user) return 0;
  const { data, error } = await supabase.rpc("claim_points");
  if (error || !Array.isArray(data)) return 0;
  let total = 0;
  for (const g of data as { points: number; amount_cents: number; currency: string; stripe_session_id: string }[]) {
    earnPoints(g.points);
    total += g.points;
    const value = g.amount_cents / 100;
    track("purchase", {
      transaction_id: g.stripe_session_id,
      value,
      currency: g.currency.toUpperCase(),
      items: [{ item_id: "points_50k", item_name: "50,000 points", price: value, quantity: 1 }]
    });
  }
  return total;
}

/** After Checkout the webhook may land a moment later: keep asking for a little while. */
export async function claimAfterCheckout(timeoutMs = 40_000): Promise<number> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const got = await claimPoints();
    if (got > 0) return got;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return 0;
}

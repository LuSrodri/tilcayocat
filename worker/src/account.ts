import {
  SKINS, SKIN_PRICES, LIZARD_PRICE, POINTS_PACK, MAX_EARN,
  type Inventory, type GuestProgress, type ShopItem, type Skin
} from "./protocol";
import type { Env } from "./index";

// Player accounts. Supabase Auth signs players in (e-mail and password); this Worker keeps what
// they own in D1: the wallet, unlocked cats and the lizard, and Stripe purchases. Prices are
// checked here, so a signed-in player's shop can't be edited from the browser.

/** The most a guest's local wallet can bring into an account in one merge. */
const GUEST_MAX = 5_000_000;
const SITES = ["https://catthemouse.co", "http://localhost:5173"];

interface AuthUser {
  id: string;
  email?: string;
  is_anonymous?: boolean;
  email_confirmed_at?: string | null;
}

interface Row {
  wallet: number;
  owned: string;
  lizard: number;
  skin: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// Recently checked tokens, so a burst of requests doesn't ask Supabase every time.
const seen = new Map<string, { user: AuthUser; until: number }>();

async function signedIn(request: Request, env: Env): Promise<AuthUser> {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const hit = seen.get(token);
  let user = hit && hit.until > Date.now() ? hit.user : null;
  if (!user) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new HttpError(401, "Your session expired. Sign in again.");
    user = (await res.json()) as AuthUser;
    if (seen.size > 500) seen.clear();
    seen.set(token, { user, until: Date.now() + 60_000 });
  }
  if (user.is_anonymous || !user.email_confirmed_at) throw new HttpError(403, "Sign in with a confirmed e-mail first");
  return user;
}

function cleanOwned(raw: unknown): Skin[] {
  const set = new Set<Skin>(["grey"]);
  if (Array.isArray(raw)) for (const id of raw) if ((SKINS as readonly string[]).includes(id)) set.add(id as Skin);
  return [...set];
}

function toInventory(row: Row): Inventory {
  const owned = cleanOwned(JSON.parse(row.owned));
  const skin = owned.includes(row.skin as Skin) ? (row.skin as Skin) : "grey";
  return { wallet: row.wallet, owned, lizard: row.lizard === 1, skin };
}

async function load(env: Env, userId: string): Promise<{ inv: Inventory; fresh: boolean }> {
  const now = Date.now();
  const made = await env.DB.prepare("INSERT OR IGNORE INTO accounts (user_id, created_at, updated_at) VALUES (?, ?, ?)").bind(userId, now, now).run();
  const row = await env.DB.prepare("SELECT wallet, owned, lizard, skin FROM accounts WHERE user_id = ?").bind(userId).first<Row>();
  return { inv: toInventory(row!), fresh: (made.meta.changes ?? 0) > 0 };
}

async function save(env: Env, userId: string, inv: Inventory, delta: number, reason: string, ref: string | null = null): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET wallet = ?, owned = ?, lizard = ?, skin = ?, updated_at = ? WHERE user_id = ?")
      .bind(inv.wallet, JSON.stringify(inv.owned), inv.lizard ? 1 : 0, inv.skin, now, userId),
    env.DB.prepare("INSERT INTO ledger (user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, delta, reason, ref, now)
  ]);
}

// ---- handlers -------------------------------------------------------------------

/** Load the account; a guest's progress from this browser is folded in once. */
async function sync(env: Env, user: AuthUser, body: { guest?: GuestProgress | null }): Promise<Inventory> {
  const { inv, fresh } = await load(env, user.id);
  const g = body.guest;
  if (!g) return inv;
  const coins = Math.max(0, Math.min(GUEST_MAX, Math.floor(Number(g.wallet) || 0)));
  const owned = cleanOwned([...inv.owned, ...cleanOwned(g.owned)]);
  const merged: Inventory = { wallet: inv.wallet + coins, owned, lizard: inv.lizard || !!g.lizard, skin: inv.skin };
  if (fresh && owned.includes(g.skin)) merged.skin = g.skin;
  await save(env, user.id, merged, coins, "guest-merge");
  return merged;
}

async function earn(env: Env, user: AuthUser, body: { points?: number; reason?: string }): Promise<Inventory> {
  const points = Math.floor(Number(body.points) || 0);
  if (points < 0 || points > MAX_EARN) throw new HttpError(400, "Bad points");
  const reason = body.reason === "duel" ? "duel" : "round";
  const now = Date.now();
  await load(env, user.id);
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?").bind(points, now, user.id),
    env.DB.prepare("INSERT INTO ledger (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)").bind(user.id, points, reason, now)
  ]);
  return (await load(env, user.id)).inv;
}

async function buy(env: Env, user: AuthUser, body: { item?: string }): Promise<Inventory> {
  const item = body.item as ShopItem;
  const isLizard = item === "lizard";
  if (!isLizard && !(SKINS as readonly string[]).includes(item)) throw new HttpError(400, "Unknown item");
  const { inv } = await load(env, user.id);
  if (isLizard ? inv.lizard : inv.owned.includes(item as Skin)) return inv;
  const price = isLizard ? LIZARD_PRICE : SKIN_PRICES[item as Skin];
  if (inv.wallet < price) throw new HttpError(409, "Not enough points");
  const next: Inventory = isLizard
    ? { ...inv, wallet: inv.wallet - price, lizard: true }
    : { ...inv, wallet: inv.wallet - price, owned: [...inv.owned, item as Skin], skin: item as Skin };
  // spend only if the wallet still holds what was read (two tabs buying at once)
  const now = Date.now();
  const res = await env.DB.prepare(
    "UPDATE accounts SET wallet = wallet - ?, owned = ?, lizard = ?, skin = ?, updated_at = ? WHERE user_id = ? AND wallet = ?"
  ).bind(price, JSON.stringify(next.owned), next.lizard ? 1 : 0, next.skin, now, user.id, inv.wallet).run();
  if (!res.meta.changes) throw new HttpError(409, "Your wallet changed. Try again.");
  await env.DB.prepare("INSERT INTO ledger (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)").bind(user.id, -price, `buy:${item}`, now).run();
  return next;
}

async function equip(env: Env, user: AuthUser, body: { skin?: string }): Promise<Inventory> {
  const { inv } = await load(env, user.id);
  const skin = body.skin as Skin;
  if (!inv.owned.includes(skin)) throw new HttpError(400, "You don't own that cat");
  await env.DB.prepare("UPDATE accounts SET skin = ?, updated_at = ? WHERE user_id = ?").bind(skin, Date.now(), user.id).run();
  return { ...inv, skin };
}

async function checkout(request: Request, env: Env, user: AuthUser): Promise<{ url: string }> {
  const origin = request.headers.get("Origin");
  const site = origin && SITES.includes(origin) ? origin : SITES[0]!;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": POINTS_PACK.currency,
    "line_items[0][price_data][unit_amount]": String(POINTS_PACK.amountCents),
    "line_items[0][price_data][product_data][name]": "50,000 shop points",
    "line_items[0][price_data][product_data][description]": "Spend them in the Cat The Mouse Company shop.",
    client_reference_id: user.id,
    "metadata[user_id]": user.id,
    "metadata[points]": String(POINTS_PACK.points),
    "payment_intent_data[metadata][user_id]": user.id,
    success_url: `${site}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?shop=1`
  });
  if (user.email) form.set("customer_email", user.email);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  const session = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !session.url) {
    console.error("stripe checkout failed", session.error?.message);
    throw new HttpError(502, "Checkout is unavailable right now");
  }
  return { url: session.url };
}

async function purchase(env: Env, user: AuthUser, url: URL): Promise<unknown> {
  const id = url.searchParams.get("session") ?? "";
  const row = await env.DB.prepare("SELECT points, amount_cents, currency FROM purchases WHERE session_id = ? AND user_id = ?").bind(id, user.id).first();
  return row ? { credited: true, ...row } : { credited: false };
}

// ---- Stripe webhook -------------------------------------------------------------

async function verifyStripe(body: string, header: string, secret: string): Promise<boolean> {
  const fields = header.split(",");
  const t = Number(fields.find((p) => p.startsWith("t="))?.slice(2));
  const sigs = fields.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!(await verifyStripe(body, request.headers.get("Stripe-Signature") ?? "", env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("bad signature", { status: 400 });
  }
  const event = JSON.parse(body) as { type: string; data: { object: Record<string, any> } };
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return new Response("ignored");
  const s = event.data.object;
  if (s.payment_status !== "paid") return new Response("not paid yet");
  const userId = String(s.metadata?.user_id ?? s.client_reference_id ?? "");
  if (!userId || s.amount_total !== POINTS_PACK.amountCents || s.currency !== POINTS_PACK.currency) {
    console.error("unexpected session", s.id, s.amount_total, s.currency);
    return new Response("unexpected session");
  }
  await load(env, userId);
  const now = Date.now();
  try {
    // one transaction: a session already recorded fails the insert and credits nothing
    await env.DB.batch([
      env.DB.prepare("INSERT INTO purchases (session_id, user_id, points, amount_cents, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(s.id, userId, POINTS_PACK.points, s.amount_total, s.currency, now),
      env.DB.prepare("UPDATE accounts SET wallet = wallet + ?, updated_at = ? WHERE user_id = ?").bind(POINTS_PACK.points, now, userId),
      env.DB.prepare("INSERT INTO ledger (user_id, delta, reason, ref, created_at) VALUES (?, ?, 'purchase', ?, ?)").bind(userId, POINTS_PACK.points, s.id, now)
    ]);
  } catch (err) {
    if (String(err).includes("UNIQUE")) return new Response("already credited");
    console.error("credit failed", s.id, err);
    return new Response("retry", { status: 500 });
  }
  return new Response("ok");
}

// ---- routing --------------------------------------------------------------------

/** Handles /account/*, /checkout, /purchase and /stripe-webhook; null for anything else. */
export async function handleAccount(path: string, request: Request, env: Env, cors: Record<string, string>): Promise<Response | null> {
  if (path === "/stripe-webhook" && request.method === "POST") return stripeWebhook(request, env);
  const routes = ["/account/sync", "/account/earn", "/account/buy", "/account/equip", "/checkout", "/purchase"];
  if (!routes.includes(path)) return null;
  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });
  try {
    const user = await signedIn(request, env);
    if (path === "/purchase") return reply(await purchase(env, user, new URL(request.url)));
    if (request.method !== "POST") return reply({ error: "method not allowed" }, 405);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (path === "/account/sync") return reply(await sync(env, user, body as { guest?: GuestProgress }));
    if (path === "/account/earn") return reply(await earn(env, user, body));
    if (path === "/account/buy") return reply(await buy(env, user, body));
    if (path === "/account/equip") return reply(await equip(env, user, body));
    return reply(await checkout(request, env, user));
  } catch (err) {
    if (err instanceof HttpError) return reply({ error: err.message }, err.status);
    console.error("account error", err);
    return reply({ error: "Something went wrong" }, 500);
  }
}

// Stripe webhook: when a Checkout Session is paid, record the points for the buyer. Stripe may
// deliver an event more than once, so the session id is unique and duplicates are ignored.
import { createClient } from "npm:@supabase/supabase-js@2";

const PACK = { points: 50_000, amountCents: 344, currency: "usd" };
const TOLERANCE_S = 300;

async function verify(body: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time compare against each v1 signature
  return sigs.some((s) => s.length === hex.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const body = await req.text();
  const ok = await verify(body, req.headers.get("Stripe-Signature") ?? "", Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "");
  if (!ok) return new Response("bad signature", { status: 400 });

  const event = JSON.parse(body);
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return new Response("ignored", { status: 200 });
  }
  const s = event.data.object;
  if (s.payment_status !== "paid") return new Response("not paid yet", { status: 200 });
  const userId = s.metadata?.user_id ?? s.client_reference_id;
  // only the pack this shop sells, at its real price
  if (!userId || s.amount_total !== PACK.amountCents || s.currency !== PACK.currency) {
    console.error("unexpected session", s.id, s.amount_total, s.currency);
    return new Response("unexpected session", { status: 200 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.from("point_grants").upsert(
    { user_id: userId, points: PACK.points, amount_cents: s.amount_total, currency: s.currency, stripe_session_id: s.id },
    { onConflict: "stripe_session_id", ignoreDuplicates: true }
  );
  if (error) {
    console.error("grant failed", s.id, error.message);
    return new Response("retry", { status: 500 });
  }
  return new Response("ok", { status: 200 });
});

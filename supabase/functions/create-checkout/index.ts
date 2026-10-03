// Starts a Stripe Checkout for the 50,000-point pack. Only players signed in with Google may buy:
// anonymous sessions are refused. The price lives here, never in the client.
import { createClient } from "npm:@supabase/supabase-js@2";

const PACK = { points: 50_000, amountCents: 344, currency: "usd", name: "50,000 shop points" };
const ORIGINS = ["https://catthemouse.co", "http://localhost:5173"];

function cors(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ORIGINS.includes(origin) ? origin : ORIGINS[0]!,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data, error } = await supabase.auth.getUser(jwt);
  const user = data?.user;
  if (error || !user) return json({ error: "not signed in" }, 401, origin);
  const google = user.identities?.some((i) => i.provider === "google");
  if (user.is_anonymous || !google) return json({ error: "sign in with Google to buy" }, 403, origin);

  const site = origin && ORIGINS.includes(origin) ? origin : ORIGINS[0]!;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": PACK.currency,
    "line_items[0][price_data][unit_amount]": String(PACK.amountCents),
    "line_items[0][price_data][product_data][name]": PACK.name,
    "line_items[0][price_data][product_data][description]": "Spend them in the Cat The Mouse Company shop.",
    client_reference_id: user.id,
    "metadata[user_id]": user.id,
    "metadata[points]": String(PACK.points),
    "payment_intent_data[metadata][user_id]": user.id,
    success_url: `${site}/?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/?shop=1`
  });
  if (user.email) form.set("customer_email", user.email);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form
  });
  const session = await res.json();
  if (!res.ok) {
    console.error("stripe checkout failed", session?.error?.message);
    return json({ error: "checkout unavailable" }, 502, origin);
  }
  return json({ url: session.url }, 200, origin);
});

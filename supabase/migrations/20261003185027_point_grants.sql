-- Points bought with Stripe. The webhook (service role) records one row per paid Checkout Session;
-- the game claims unclaimed rows for the signed-in player and adds them to the wallet on the device.

create table public.point_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  points integer not null check (points > 0),
  amount_cents integer not null,
  currency text not null,
  stripe_session_id text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

create index point_grants_user_unclaimed on public.point_grants (user_id) where claimed_at is null;

alter table public.point_grants enable row level security;

-- players may read their own purchases; only the service role writes
create policy "read own grants" on public.point_grants
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Hand over every unclaimed grant of the caller, once. Returns what was claimed so the client can
-- credit the wallet and report the purchase to analytics.
create function public.claim_points()
returns table (id uuid, points integer, amount_cents integer, currency text, stripe_session_id text)
language sql
security definer
set search_path = ''
as $$
  update public.point_grants g
     set claimed_at = now()
   where g.user_id = (select auth.uid())
     and g.claimed_at is null
  returning g.id, g.points, g.amount_cents, g.currency, g.stripe_session_id;
$$;

revoke all on function public.claim_points() from public, anon;
grant execute on function public.claim_points() to authenticated;

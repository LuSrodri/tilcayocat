-- Wallets and purchases moved to Cloudflare D1 (the game's Worker); Supabase now only signs players in.
drop function if exists public.claim_points();
drop table if exists public.point_grants;

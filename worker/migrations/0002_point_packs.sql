-- Several point packs: which one each purchase was. Everything sold before this was the
-- 50,000-point starter pack, which an account can only buy once.
ALTER TABLE purchases ADD COLUMN pack TEXT NOT NULL DEFAULT 'starter';
CREATE INDEX purchases_user_pack ON purchases (user_id, pack);

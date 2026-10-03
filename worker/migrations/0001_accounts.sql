-- Player accounts (keyed by the Supabase Auth user id). Guests keep their progress in the browser;
-- once they sign in, their wallet and unlocks live here and every change goes through the Worker.

CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  wallet INTEGER NOT NULL DEFAULT 0 CHECK (wallet >= 0),
  owned TEXT NOT NULL DEFAULT '["grey"]',   -- JSON array of cat ids
  lizard INTEGER NOT NULL DEFAULT 0,
  skin TEXT NOT NULL DEFAULT 'grey',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- every change to a wallet, for support and to spot abuse
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,          -- round | duel | guest-merge | buy:<item> | purchase
  ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ledger_user ON ledger (user_id, created_at);

-- paid Stripe Checkout Sessions; the primary key makes a repeated webhook a no-op
CREATE TABLE purchases (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX purchases_user ON purchases (user_id);

-- MBP Games accounts: one account per email, shared by every MBP game.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  banned_at INTEGER,
  ban_reason TEXT
);

-- A sign-in request: the emailed link (token) and the tab that waits for it (poll).
CREATE TABLE magic_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  poll_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  client TEXT,
  redirect_uri TEXT,
  state TEXT,
  code_challenge TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  user_id TEXT,
  finished_at INTEGER
);
CREATE INDEX magic_links_email ON magic_links (email, created_at);
CREATE INDEX magic_links_ip ON magic_links (ip, created_at);

-- One-time codes a game swaps for a session token (PKCE).
CREATE TABLE auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- kind 'web' is the cookie on this site, 'game' a bearer token held by a game.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  client TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- A player's save in one game. rev goes up on every write; a write must name the rev it builds on.
CREATE TABLE progress (
  user_id TEXT NOT NULL,
  game TEXT NOT NULL,
  data TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);

CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  admin TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT,
  game TEXT,
  detail TEXT
);
CREATE INDEX admin_log_user ON admin_log (user_id, at);

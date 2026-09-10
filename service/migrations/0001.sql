PRAGMA foreign_keys = ON;
CREATE TABLE subscribers (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 0,
  unsubscribe_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  confirm_hash TEXT NOT NULL UNIQUE, confirmed INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL, confirm_expires INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX sessions_subscriber ON sessions(subscriber_id);
CREATE TABLE schedules (
  subscriber_id TEXT PRIMARY KEY REFERENCES subscribers(id), scope TEXT NOT NULL,
  observed_at INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, subscriber_id TEXT NOT NULL REFERENCES subscribers(id), scope TEXT NOT NULL,
  window_id TEXT NOT NULL, label TEXT NOT NULL, due_at INTEGER NOT NULL, observed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', claimed_at INTEGER
);
CREATE INDEX jobs_due ON jobs(status, due_at);
CREATE INDEX jobs_subscriber ON jobs(subscriber_id, status);
CREATE TABLE counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE unsubscribe_links (token_hash TEXT PRIMARY KEY, subscriber_id TEXT NOT NULL REFERENCES subscribers(id));

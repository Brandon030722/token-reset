CREATE TABLE mail_diagnostics (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  status INTEGER,
  code TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE invitations (
  code_hash TEXT PRIMARY KEY,
  subscriber_id TEXT REFERENCES subscribers(id),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  created_at INTEGER NOT NULL,
  bound_at INTEGER
);
CREATE INDEX invitations_subscriber ON invitations(subscriber_id);
ALTER TABLE sessions ADD COLUMN invite_hash TEXT REFERENCES invitations(code_hash);

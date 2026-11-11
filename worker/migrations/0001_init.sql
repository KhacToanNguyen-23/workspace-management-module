-- Writing Bank module: members, workspaces, permissions, corpus.
-- D1 (SQLite). Times are ISO-8601 UTC strings.

-- Users of the @hyperdatalab.org domain. Rows come from two places:
-- the Google Directory sync (directory_status set) and first sign-in (firebase_uid set).
CREATE TABLE users (
  email            TEXT PRIMARY KEY,           -- lowercased, always @hyperdatalab.org
  firebase_uid     TEXT UNIQUE,
  name             TEXT NOT NULL DEFAULT '',
  photo_url        TEXT,
  org_unit         TEXT,
  directory_status TEXT NOT NULL DEFAULT 'unknown' CHECK (directory_status IN ('active','suspended','missing','unknown')),
  global_role      TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('user','admin')),
  disabled         INTEGER NOT NULL DEFAULT 0,  -- blocked by an admin inside this app
  first_seen       TEXT,
  last_seen        TEXT,
  synced_at        TEXT
);

-- Kinds of workspace. default_permissions is a JSON array used when a workspace is created.
CREATE TABLE workspace_types (
  code                TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  default_permissions TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL REFERENCES workspace_types(code),
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Permissions switched on for a workspace. A member's effective permissions are
-- (permissions of their role) ∩ (permissions enabled here).
CREATE TABLE workspace_permissions (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  permission   TEXT NOT NULL,
  granted_by   TEXT NOT NULL,
  granted_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, permission)
);

-- Join requests and memberships share one row per (workspace, user).
CREATE TABLE memberships (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_email   TEXT NOT NULL REFERENCES users(email),
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer','member','manager')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked')),
  note         TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL,
  decided_by   TEXT,
  decided_at   TEXT,
  decision_note TEXT NOT NULL DEFAULT '',
  UNIQUE (workspace_id, user_email)
);
CREATE INDEX idx_memberships_user ON memberships(user_email);
CREATE INDEX idx_memberships_ws_status ON memberships(workspace_id, status);

CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  workspace_id TEXT,
  detail  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_ws ON audit_log(workspace_id, id);

-- A corpus is a named collection of documents inside one workspace.
CREATE TABLE corpora (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

-- Pipeline: fetched (metadata only) -> downloaded (file stored) -> extracted (sentences).
CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  corpus_id     TEXT NOT NULL REFERENCES corpora(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL,
  source        TEXT NOT NULL,              -- openalex | crossref | manual
  external_id   TEXT NOT NULL,
  doi           TEXT,
  title         TEXT NOT NULL DEFAULT '',
  authors       TEXT NOT NULL DEFAULT '[]', -- JSON array of names
  year          INTEGER,
  venue         TEXT,
  abstract      TEXT,
  license       TEXT,
  is_oa         INTEGER NOT NULL DEFAULT 0,
  oa_url        TEXT,
  status        TEXT NOT NULL DEFAULT 'fetched'
                CHECK (status IN ('fetched','downloaded','download_failed','extracted','extract_failed')),
  content_key   TEXT,
  content_type  TEXT,
  content_bytes INTEGER,
  content_sha256 TEXT,
  error         TEXT,
  added_by      TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  downloaded_at TEXT,
  extracted_at  TEXT,
  sentence_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (corpus_id, source, external_id)
);
CREATE INDEX idx_documents_corpus_status ON documents(corpus_id, status);
CREATE INDEX idx_documents_doi ON documents(corpus_id, doi);

CREATE TABLE sentences (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  section     TEXT NOT NULL DEFAULT 'body',
  text        TEXT NOT NULL,
  PRIMARY KEY (document_id, idx)
);

INSERT INTO workspace_types (code, name, description, default_permissions) VALUES
  ('research',   'Research',   'Build and mine corpora for a writing project.',
     '["corpus.read","corpus.write","corpus.fetch","corpus.download","extraction.run"]'),
  ('annotation', 'Annotation', 'Read and extract from corpora prepared by others.',
     '["corpus.read","extraction.run"]'),
  ('review',     'Review',     'Read-only access for reviewers.',
     '["corpus.read"]');

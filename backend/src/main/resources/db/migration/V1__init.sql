-- Writing Bank module: users (from the org user directory), web workspaces, permissions.
-- "Workspace" here is the web app's own workspace (a team space inside Writing Bank),
-- not a Google Workspace. Google is only used for sign-in and the user directory.

-- Users of the @hyperdatalab.org domain. Rows come from the user directory sync
-- and from first sign-in.
CREATE TABLE users (
    email            TEXT PRIMARY KEY,                    -- lowercased
    auth_uid         TEXT UNIQUE,                         -- Firebase uid
    name             TEXT NOT NULL DEFAULT '',
    photo_url        TEXT,
    department       TEXT,                                -- org unit / department from the directory
    directory_status TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (directory_status IN ('active', 'suspended', 'missing', 'unknown')),
    global_role      TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('user', 'admin')),
    disabled         BOOLEAN NOT NULL DEFAULT FALSE,      -- blocked by an admin of this app
    first_seen       TIMESTAMPTZ,
    last_seen        TIMESTAMPTZ,
    synced_at        TIMESTAMPTZ
);

-- Kinds of workspace; default_permissions are switched on when a workspace is created.
CREATE TABLE workspace_types (
    code                TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    default_permissions TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL REFERENCES workspace_types (code),
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permissions switched on for a workspace by its manager or an admin.
CREATE TABLE workspace_permissions (
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    permission   TEXT NOT NULL,
    granted_by   TEXT NOT NULL,
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, permission)
);

-- One row per (workspace, user): the join request and, once approved, the membership.
CREATE TABLE memberships (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_email    TEXT NOT NULL REFERENCES users (email),
    role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('viewer', 'member', 'manager')),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
    note          TEXT NOT NULL DEFAULT '',
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT '',
    UNIQUE (workspace_id, user_email)
);
CREATE INDEX idx_memberships_user ON memberships (user_email);
CREATE INDEX idx_memberships_ws_status ON memberships (workspace_id, status);

CREATE TABLE audit_log (
    id           BIGSERIAL PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor        TEXT NOT NULL,
    action       TEXT NOT NULL,
    target       TEXT NOT NULL DEFAULT '',
    workspace_id UUID,
    detail       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_ws ON audit_log (workspace_id, id DESC);

INSERT INTO workspace_types (code, name, description, default_permissions) VALUES
    ('research',   'Research',   'Team that builds and edits Writing Bank content.',
        '{workspace.read,workspace.write}'),
    ('review',     'Review',     'Team that reviews and approves content.',
        '{workspace.read,workspace.review}'),
    ('readonly',   'Read only',  'Read access only.',
        '{workspace.read}');

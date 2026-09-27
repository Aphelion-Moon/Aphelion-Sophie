-- Ordinary messages must not invalidate all AI turns, but access/audience changes must.
ALTER TABLE sophie_core.gateway_lifecycle ADD COLUMN ai_boundary_epoch bigint NOT NULL DEFAULT 0 CHECK (ai_boundary_epoch>=0);

-- Public approved knowledge has its own identity; no case, consent or conversation tables.
CREATE SCHEMA sophie_knowledge;
REVOKE ALL ON SCHEMA sophie_knowledge FROM PUBLIC;
CREATE TABLE sophie_knowledge.documents (
  guild_id text NOT NULL CHECK(guild_id ~ '^[1-9][0-9]{0,19}$'),
  id text NOT NULL CHECK(id ~ '^[a-z][a-z0-9-]{0,47}$'),
  epoch bigint NOT NULL CHECK(epoch>0), revision integer NOT NULL CHECK(revision>0),
  withdrawn boolean NOT NULL, source_current boolean NOT NULL, valid_until timestamptz,
  PRIMARY KEY(guild_id,id)
);
CREATE TABLE sophie_knowledge.publications (
  guild_id text NOT NULL, document_id text NOT NULL, revision integer NOT NULL CHECK(revision>0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), document jsonb,
  PRIMARY KEY(guild_id,document_id,revision), FOREIGN KEY(guild_id,document_id) REFERENCES sophie_knowledge.documents
);
CREATE TABLE sophie_knowledge.chunks (
  guild_id text NOT NULL, document_id text NOT NULL, revision integer NOT NULL,
  source_id text NOT NULL, publication_sha256 text NOT NULL CHECK(publication_sha256 ~ '^[a-f0-9]{64}$'),
  title text NOT NULL, heading text NOT NULL, text text, url text NOT NULL, authority text NOT NULL,
  aliases text[] NOT NULL, search tsvector NOT NULL,
  PRIMARY KEY(guild_id,source_id), FOREIGN KEY(guild_id,document_id,revision) REFERENCES sophie_knowledge.publications
);
CREATE INDEX knowledge_search ON sophie_knowledge.chunks USING gin(search);
CREATE TABLE sophie_knowledge.receipts (
  guild_id text NOT NULL, request_id text NOT NULL CHECK(request_id ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL CHECK(actor_id ~ '^[1-9][0-9]{0,19}$'), review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
  document_id text NOT NULL, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,request_id), FOREIGN KEY(guild_id,document_id,revision) REFERENCES sophie_knowledge.publications
);
REVOKE ALL ON ALL TABLES IN SCHEMA sophie_knowledge FROM PUBLIC;

ALTER TABLE sophie_core.dashboard_login_flows
  DROP CONSTRAINT dashboard_login_flows_return_path_check,
  ADD CONSTRAINT dashboard_login_flows_return_path_check CHECK (
    return_path IN ('/', '/localizations', '/ticket-forms', '/automation', '/permissions', '/contacts', '/contact-entry',
      '/answers', '/cases', '/manage-cases', '/case-replies', '/staff-notes', '/case-labels', '/ai', '/ai-preferences', '/ai-knowledge')
  );

-- Public wiki import state only. A collected snapshot is never a publication.
-- Preserve request identity independently of the mutable source generation in new review hashes.
ALTER TABLE sophie_knowledge.receipts ADD COLUMN input_sha256 text CHECK(input_sha256 ~ '^[a-f0-9]{64}$');
UPDATE sophie_knowledge.receipts SET input_sha256=review_sha256;
ALTER TABLE sophie_knowledge.receipts ALTER COLUMN input_sha256 SET NOT NULL;
CREATE TABLE sophie_knowledge.import_sources (
  guild_id text NOT NULL CHECK(guild_id ~ '^[1-9][0-9]{0,19}$'),
  collection_id text NOT NULL CHECK(collection_id='meridian-policies'),
  epoch bigint NOT NULL DEFAULT 0 CHECK(epoch>=0),
  state text NOT NULL DEFAULT 'unavailable' CHECK(state IN ('unavailable','pending','ready')),
  snapshot_sha256 text CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz, valid_until timestamptz,
  lease_fence uuid, lease_until timestamptz,
  PRIMARY KEY(guild_id,collection_id)
);
CREATE TABLE sophie_knowledge.import_snapshots (
  guild_id text NOT NULL, collection_id text NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  snapshot_integrity text NOT NULL CHECK(snapshot_integrity ~ '^[a-f0-9]{64}$'),
  extraction_integrity text CHECK(extraction_integrity ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=2097152),
  extraction jsonb CHECK(extraction IS NULL OR jsonb_typeof(extraction)='object' AND octet_length(extraction::text)<=4194304),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(guild_id,collection_id,sha256),
  FOREIGN KEY(guild_id,collection_id) REFERENCES sophie_knowledge.import_sources
);
REVOKE ALL ON sophie_knowledge.import_sources,sophie_knowledge.import_snapshots FROM PUBLIC;

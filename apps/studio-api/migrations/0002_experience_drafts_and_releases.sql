-- Experience drafts and immutable releases (Task A-01, Module M-CFG)
DO $$
BEGIN
  CREATE SCHEMA IF NOT EXISTS product;

  CREATE TABLE IF NOT EXISTS product.experiences (
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    activity_type TEXT DEFAULT 'personality_assessment' NOT NULL,
    revision INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
  );

  CREATE TABLE IF NOT EXISTS product.experience_drafts (
    draft_id TEXT NOT NULL,
    experience_id TEXT NOT NULL,
    revision INTEGER DEFAULT 0 NOT NULL,
    content_hash TEXT NOT NULL,
    content JSONB DEFAULT '{}'::jsonb NOT NULL,
    updated_by TEXT DEFAULT 'admin' NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (draft_id),
    CONSTRAINT experience_drafts_experience_id_unique UNIQUE (experience_id),
    CONSTRAINT experience_drafts_experience_id_fkey FOREIGN KEY (experience_id)
      REFERENCES product.experiences(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS product.experience_releases (
    id TEXT NOT NULL,
    experience_id TEXT NOT NULL,
    definition_version TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    definition_schema_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    is_demo BOOLEAN DEFAULT false NOT NULL,
    approval_refs JSONB DEFAULT '[]'::jsonb NOT NULL,
    validation_id TEXT NOT NULL,
    evaluation_id TEXT NOT NULL,
    content JSONB NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    published_by TEXT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT experience_releases_experience_id_fkey FOREIGN KEY (experience_id)
      REFERENCES product.experiences(id),
    CONSTRAINT experience_releases_exp_id_def_ver_unique UNIQUE (experience_id, definition_version)
  );

  CREATE TABLE IF NOT EXISTS product.idempotency_records (
    scope TEXT NOT NULL,
    key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (scope, key)
  );

  -- Immutability trigger for experience_releases (AT-04, FR-CFG-05)
  CREATE OR REPLACE FUNCTION product.prevent_experience_release_mutation()
  RETURNS trigger AS $fn$
  BEGIN
    RAISE EXCEPTION 'experience_releases is immutable: UPDATE and DELETE are prohibited'
      USING ERRCODE = 'restrict_violation';
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS experience_releases_immutable_trigger ON product.experience_releases;
  CREATE TRIGGER experience_releases_immutable_trigger
  BEFORE UPDATE OR DELETE ON product.experience_releases
  FOR EACH ROW EXECUTE FUNCTION product.prevent_experience_release_mutation();
END
$$;


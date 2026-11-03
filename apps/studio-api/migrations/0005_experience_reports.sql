DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS product.experience_reports (
    id TEXT NOT NULL,
    experience_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('validation', 'evaluation')),
    draft_revision BIGINT NOT NULL CHECK (draft_revision >= 0),
    content_hash TEXT NOT NULL,
    definition_schema_version TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'unsupported')),
    mandatory_passed BOOLEAN NOT NULL,
    report JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT experience_reports_experience_id_fkey FOREIGN KEY (experience_id)
      REFERENCES product.experiences(id)
  );

  CREATE INDEX IF NOT EXISTS experience_reports_exp_hash_idx
    ON product.experience_reports (experience_id, content_hash, kind, created_at DESC);

  CREATE OR REPLACE FUNCTION product.prevent_experience_report_mutation()
  RETURNS trigger AS $fn$
  BEGIN
    RAISE EXCEPTION 'experience_reports is immutable: UPDATE, DELETE and TRUNCATE are prohibited'
      USING ERRCODE = 'restrict_violation';
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS experience_reports_immutable_trigger ON product.experience_reports;
  CREATE TRIGGER experience_reports_immutable_trigger
  BEFORE UPDATE OR DELETE ON product.experience_reports
  FOR EACH ROW EXECUTE FUNCTION product.prevent_experience_report_mutation();

  DROP TRIGGER IF EXISTS experience_reports_no_truncate_trigger ON product.experience_reports;
  CREATE TRIGGER experience_reports_no_truncate_trigger
  BEFORE TRUNCATE ON product.experience_reports
  FOR EACH STATEMENT EXECUTE FUNCTION product.prevent_experience_report_mutation();
END
$$;

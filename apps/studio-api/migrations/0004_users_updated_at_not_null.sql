-- New users get updated_at = created_at (same transaction clock) instead of NULL.
UPDATE product.users SET updated_at = created_at WHERE updated_at IS NULL;
--> statement-breakpoint
ALTER TABLE product.users ALTER COLUMN updated_at SET DEFAULT now(), ALTER COLUMN updated_at SET NOT NULL;

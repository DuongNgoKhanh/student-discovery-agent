CREATE TABLE product.auth_sessions (
  id uuid PRIMARY KEY,
  user_id integer NOT NULL REFERENCES product.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_expiry_idx ON product.auth_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE product.auth_refresh_tokens (
  token_hash varchar(64) PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES product.auth_sessions(id) ON DELETE CASCADE,
  consumed_at timestamptz
);
CREATE INDEX auth_refresh_session_idx ON product.auth_refresh_tokens(session_id);
--> statement-breakpoint
CREATE TABLE product.auth_registration_limits (
  key_hash varchar(64) PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_registration_expiry_idx ON product.auth_registration_limits(expires_at);

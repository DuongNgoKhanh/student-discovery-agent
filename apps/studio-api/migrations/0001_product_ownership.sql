-- Product ownership of users/versions (hand-written; journal entry scaffolded like drizzle-kit --custom).
--
-- Three DB states are handled per table, after a preflight over BOTH tables:
--   * public.X and product.X both exist  -> RAISE (whole migration transaction rolls back).
--   * only public.X (legacy SQLModel)    -> ALTER TABLE ... SET SCHEMA product. Indexes, constraints
--                                           and the column-owned SERIAL sequence move with the table;
--                                           the id default references the sequence by OID, and
--                                           last_value/is_called are untouched.
--   * neither                            -> CREATE TABLE in product with the exact legacy DDL
--                                           (tests/fixtures/legacy/schema.sql).
--   * only product.X                     -> nothing to do.
-- Never drops, copies or seeds data.
DO $$
DECLARE
  t text;
  seq text;
BEGIN
  CREATE SCHEMA IF NOT EXISTS product;

  FOREACH t IN ARRAY ARRAY['users', 'versions'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL
       AND to_regclass(format('product.%I', t)) IS NOT NULL THEN
      RAISE EXCEPTION 'Product ownership conflict: both public.% and product.% exist; resolve manually before migrating', t, t
        USING ERRCODE = 'duplicate_table';
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['users', 'versions'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA product', t);
      -- PostgreSQL moves column-owned sequences with the table (and refuses to move an owned
      -- sequence on its own). Assert it so a non-SERIAL legacy shape fails loudly and rolls back.
      seq := pg_get_serial_sequence(format('product.%I', t), 'id');
      IF seq IS NULL OR seq <> format('product.%s_id_seq', t) THEN
        RAISE EXCEPTION 'Product ownership: product.% id sequence not owned/moved as expected (got %)', t, seq;
      END IF;
    END IF;
  END LOOP;

  IF to_regclass('product.users') IS NULL THEN
    CREATE TABLE product.users (
      id SERIAL NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE,
      is_deleted BOOLEAN NOT NULL,
      email VARCHAR(255) NOT NULL,
      hashed_password VARCHAR(255),
      name VARCHAR(255),
      avatar_url VARCHAR(500),
      bio TEXT,
      position VARCHAR(255),
      PRIMARY KEY (id),
      UNIQUE (email)
    );
  END IF;

  IF to_regclass('product.versions') IS NULL THEN
    CREATE TABLE product.versions (
      id SERIAL NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE,
      version VARCHAR(50) NOT NULL,
      description VARCHAR(500),
      is_current BOOLEAN NOT NULL,
      is_deprecated BOOLEAN NOT NULL,
      PRIMARY KEY (id),
      UNIQUE (version)
    );
  END IF;
END
$$;

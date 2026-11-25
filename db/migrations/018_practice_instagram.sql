CREATE TABLE instagram_practice_connections (
  restaurant_id uuid PRIMARY KEY REFERENCES restaurants(id),
  state text NOT NULL CHECK (state IN ('connected', 'expired')),
  last_synced_at timestamptz,
  last_error text CHECK (last_error IN ('expired', 'rate_limited', 'unavailable')),
  media jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE instagram_practice_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON instagram_practice_connections FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON instagram_practice_connections FROM %I', role_name);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

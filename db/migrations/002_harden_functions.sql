-- Supabase lets PUBLIC (and therefore anon/authenticated) execute new functions by default.
-- forbid_change() is only ever run by the append-only triggers, which do not check the caller's
-- EXECUTE right, so nobody needs to call it directly.
REVOKE EXECUTE ON FUNCTION forbid_change() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION forbid_change() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION forbid_change() FROM authenticated;
  END IF;
END $$;

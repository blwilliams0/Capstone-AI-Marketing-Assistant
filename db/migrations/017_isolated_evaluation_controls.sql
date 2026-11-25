CREATE TABLE reference_image_permissions (
  version_id uuid PRIMARY KEY REFERENCES visual_standards(version_id),
  allowed boolean NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evaluation_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evaluation_provider_calls_restaurant ON evaluation_provider_calls(restaurant_id);
ALTER TABLE reference_image_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_provider_calls ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER evaluation_provider_calls_append_only BEFORE UPDATE OR DELETE ON evaluation_provider_calls
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
REVOKE ALL ON reference_image_permissions, evaluation_provider_calls FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON reference_image_permissions, evaluation_provider_calls FROM %I', role_name);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

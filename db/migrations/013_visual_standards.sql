ALTER TABLE knowledge_versions ADD UNIQUE (id, restaurant_id);

CREATE TABLE visual_standards (
  version_id uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reference', 'preset')),
  asset_id uuid,
  classification text CHECK (classification IN ('on_brand', 'off_brand', 'adjust', 'inspiration')),
  category text,
  recipe jsonb,
  CHECK ((kind = 'reference' AND asset_id IS NOT NULL AND classification IS NOT NULL AND recipe IS NULL)
    OR (kind = 'preset' AND asset_id IS NULL AND classification IS NULL AND recipe IS NOT NULL)),
  FOREIGN KEY (version_id, restaurant_id) REFERENCES knowledge_versions(id, restaurant_id),
  FOREIGN KEY (asset_id, restaurant_id) REFERENCES visual_assets(id, restaurant_id)
);
CREATE TRIGGER visual_standards_append_only BEFORE UPDATE OR DELETE ON visual_standards
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
ALTER TABLE visual_standards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_standards FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON visual_standards FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON visual_standards FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

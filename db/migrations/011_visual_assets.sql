CREATE TABLE visual_assets (
  id uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  owner_id uuid NOT NULL REFERENCES profiles(user_id),
  parent_id uuid,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  input_sha256 text NOT NULL,
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND 10485760),
  sha256 text GENERATED ALWAYS AS (encode(sha256(image_bytes), 'hex')) STORED,
  edits jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id, owner_id),
  FOREIGN KEY (parent_id, restaurant_id, owner_id) REFERENCES visual_assets(id, restaurant_id, owner_id),
  CHECK ((edits IS NULL) = (parent_id IS NULL)),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX visual_assets_owner ON visual_assets(restaurant_id, owner_id, created_at DESC);
CREATE TRIGGER visual_assets_append_only BEFORE UPDATE OR DELETE ON visual_assets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_task_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_task_check
  CHECK (task IN ('answer', 'draft', 'interview', 'extract', 'photo_review'));

ALTER TABLE visual_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_assets FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON visual_assets FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON visual_assets FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

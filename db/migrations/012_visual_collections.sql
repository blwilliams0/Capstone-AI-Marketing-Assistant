ALTER TABLE visual_assets ADD UNIQUE (id, restaurant_id);

CREATE TABLE visual_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  owner_id uuid NOT NULL REFERENCES profiles(user_id),
  kind text NOT NULL CHECK (kind IN ('album', 'feed')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  visibility text NOT NULL CHECK (visibility IN ('private', 'team', 'management')),
  revision int NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (id, restaurant_id)
);

CREATE TABLE visual_collection_items (
  collection_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  position int NOT NULL CHECK (position >= 0),
  existing_feed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (collection_id, asset_id),
  UNIQUE (collection_id, position),
  FOREIGN KEY (collection_id, restaurant_id) REFERENCES visual_collections(id, restaurant_id),
  FOREIGN KEY (asset_id, restaurant_id) REFERENCES visual_assets(id, restaurant_id)
);
CREATE INDEX visual_collections_tenant ON visual_collections(restaurant_id, kind);
CREATE INDEX visual_collection_asset ON visual_collection_items(asset_id, restaurant_id);

ALTER TABLE visual_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_collection_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_collections, visual_collection_items FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON visual_collections, visual_collection_items FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON visual_collections, visual_collection_items FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

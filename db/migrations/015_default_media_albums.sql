ALTER TABLE visual_collections ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE visual_collections
  ADD COLUMN default_key text,
  ADD COLUMN archived_at timestamptz,
  ADD UNIQUE (restaurant_id, default_key),
  ADD CHECK (
    (default_key IS NULL AND owner_id IS NOT NULL)
    OR (default_key IS NOT NULL AND owner_id IS NULL AND kind = 'album' AND visibility <> 'private')
  ),
  ADD CHECK (archived_at IS NULL OR kind = 'album');

CREATE FUNCTION initialize_default_media_albums(tenant_id uuid) RETURNS void
LANGUAGE sql SET search_path = public, pg_temp AS $$
  INSERT INTO visual_collections (restaurant_id, kind, name, visibility, default_key)
  SELECT tenant_id, 'album', label, 'team', key
  FROM (VALUES
    ('food', 'Food & Dining'), ('drinks', 'Wine & Cocktails'), ('patio', 'The Patio'),
    ('interiors', 'Atmosphere & Interiors'), ('staff', 'Staff & Hospitality'), ('events', 'Private Events'),
    ('seasonal', 'Seasonal Photography'), ('behind', 'Behind the Scenes'),
    ('inspiration', 'Brand Inspiration'), ('edits', 'Edited Photography')
  ) AS defaults(key, label)
  ON CONFLICT (restaurant_id, default_key) DO NOTHING;
$$;

SELECT initialize_default_media_albums(id) FROM restaurants;

CREATE FUNCTION on_restaurant_initialize_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM initialize_default_media_albums(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER restaurant_initialize_media AFTER INSERT ON restaurants
FOR EACH ROW EXECUTE FUNCTION on_restaurant_initialize_media();

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON visual_collections, visual_collection_items FROM %I', role_name);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

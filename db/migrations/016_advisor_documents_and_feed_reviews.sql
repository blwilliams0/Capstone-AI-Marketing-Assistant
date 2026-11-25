CREATE TABLE advisor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, restaurant_id) REFERENCES conversations(id, restaurant_id)
);
CREATE INDEX advisor_documents_conversation ON advisor_documents(conversation_id, created_at DESC);

CREATE TABLE feed_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  layout_id uuid,
  layout_revision int CHECK (layout_revision > 0),
  photos jsonb NOT NULL,
  visual_standards jsonb NOT NULL,
  result jsonb NOT NULL,
  provider text NOT NULL CHECK (provider IN ('mock', 'anthropic')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((layout_id IS NULL) = (layout_revision IS NULL)),
  FOREIGN KEY (layout_id, restaurant_id) REFERENCES visual_collections(id, restaurant_id)
);
CREATE INDEX feed_evaluations_owner ON feed_evaluations(restaurant_id, user_id, created_at DESC);
ALTER TABLE advisor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_evaluations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER feed_evaluations_append_only BEFORE UPDATE OR DELETE ON feed_evaluations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
REVOKE ALL ON advisor_documents, feed_evaluations FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON advisor_documents, feed_evaluations FROM %I', role_name);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
    END IF;
  END LOOP;
END $$;

ALTER TABLE feed_evaluations ADD UNIQUE (id, restaurant_id);
ALTER TABLE conversations ADD COLUMN feed_evaluation_id uuid;
ALTER TABLE conversations ADD FOREIGN KEY (feed_evaluation_id, restaurant_id)
  REFERENCES feed_evaluations(id, restaurant_id);

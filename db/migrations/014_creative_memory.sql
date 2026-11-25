CREATE TABLE visual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  result jsonb NOT NULL,
  simulated boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id)
);
CREATE TABLE visual_review_assets (
  review_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  position int NOT NULL CHECK (position BETWEEN 0 AND 2),
  PRIMARY KEY (review_id, position),
  FOREIGN KEY (review_id, restaurant_id) REFERENCES visual_reviews(id, restaurant_id),
  FOREIGN KEY (asset_id, restaurant_id) REFERENCES visual_assets(id, restaurant_id)
);
CREATE INDEX visual_reviews_actor ON visual_reviews(restaurant_id, user_id, created_at DESC);

CREATE TABLE advisor_preferences (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  enabled boolean NOT NULL DEFAULT false,
  detail text NOT NULL CHECK (detail IN ('standard', 'brief', 'detailed')),
  workflow text NOT NULL CHECK (workflow IN ('none', 'brainstorm', 'writing', 'photography')),
  PRIMARY KEY (restaurant_id, user_id)
);

CREATE TABLE advisor_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  conversation_id uuid REFERENCES conversations(id),
  visual_review_id uuid,
  rating text NOT NULL CHECK (rating IN ('helpful', 'unhelpful', 'on_brand', 'off_brand', 'correction')),
  note text CHECK (char_length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(conversation_id, visual_review_id) = 1),
  FOREIGN KEY (visual_review_id, restaurant_id) REFERENCES visual_reviews(id, restaurant_id)
);

CREATE TRIGGER visual_reviews_append_only BEFORE UPDATE OR DELETE ON visual_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER visual_review_assets_append_only BEFORE UPDATE OR DELETE ON visual_review_assets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER advisor_feedback_append_only BEFORE UPDATE OR DELETE ON advisor_feedback
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE visual_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_review_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisor_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON visual_reviews, visual_review_assets, advisor_preferences, advisor_feedback FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON visual_reviews, visual_review_assets, advisor_preferences, advisor_feedback FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON visual_reviews, visual_review_assets, advisor_preferences, advisor_feedback FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

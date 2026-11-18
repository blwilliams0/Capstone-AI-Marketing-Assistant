-- Knowledge library: brand rules, verified facts, strategy and reference documents.
-- Every change is a new immutable version. Only a human with brand.approve (enforced in the API)
-- can approve; the database guarantees approved content can never be edited in place, and that
-- nothing is ever inserted already approved.

CREATE TABLE knowledge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('brand_rule', 'fact', 'strategy', 'reference')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- Brand core = sent with every AI request. Only short items (rules, facts) may be in it.
  in_brand_core BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  retired_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  retire_reason TEXT,
  UNIQUE (id, restaurant_id),
  CHECK (NOT in_brand_core OR kind IN ('brand_rule', 'fact')),
  CHECK ((retired_at IS NULL) = (retired_by IS NULL))
);
CREATE INDEX idx_knowledge_items_restaurant_kind ON knowledge_items(restaurant_id, kind);

CREATE TABLE knowledge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 100000),
  digest TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK (origin IN ('human', 'interview', 'ai_proposal')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
  -- Where this came from, e.g. "Confirmed by Chef Mike, Nov 12" or "Team strategy draft".
  source_note TEXT CHECK (source_note IS NULL OR char_length(source_note) <= 500),
  proposed_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  superseded_at TIMESTAMPTZ,
  -- Mainly for facts: after this time the version is no longer used.
  expires_at TIMESTAMPTZ,
  FOREIGN KEY (item_id, restaurant_id) REFERENCES knowledge_items(id, restaurant_id) ON DELETE RESTRICT,
  UNIQUE (item_id, version),
  CHECK ((status = 'proposed') = (decided_by IS NULL)),
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);
-- At most one approved (current) version per item.
CREATE UNIQUE INDEX uniq_knowledge_one_approved ON knowledge_versions(item_id) WHERE status = 'approved';
CREATE INDEX idx_knowledge_versions_restaurant_status ON knowledge_versions(restaurant_id, status);

-- A version's text split by heading, for full-text search. Derived data, written once.
CREATE TABLE knowledge_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES knowledge_versions(id) ON DELETE RESTRICT,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  heading TEXT NOT NULL,
  body TEXT NOT NULL,
  search TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', body), 'B')
  ) STORED,
  UNIQUE (version_id, position)
);
CREATE INDEX idx_knowledge_sections_search ON knowledge_sections USING GIN (search);
CREATE INDEX idx_knowledge_sections_version ON knowledge_sections(version_id);

-- Digest is always computed by the database from the body, so it cannot be forged.
CREATE FUNCTION knowledge_version_before_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'proposed' OR NEW.decided_by IS NOT NULL OR NEW.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'knowledge versions must be created as proposals; approval is a separate step';
  END IF;
  NEW.digest := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION knowledge_version_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'knowledge versions cannot be deleted';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.digest IS DISTINCT FROM OLD.digest
     OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.source_note IS DISTINCT FROM OLD.source_note OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
     OR NEW.proposed_at IS DISTINCT FROM OLD.proposed_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'knowledge version content is immutable; propose a new version instead';
  END IF;
  IF OLD.status = 'proposed' AND NEW.status IN ('approved', 'rejected') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
     AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by
     AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
     AND NEW.decision_note IS NOT DISTINCT FROM OLD.decision_note THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid knowledge version change (% -> %)', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION knowledge_item_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'knowledge items cannot be deleted; retire them instead';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'knowledge item identity cannot change';
  END IF;
  IF OLD.retired_at IS NOT NULL AND (NEW.retired_at IS DISTINCT FROM OLD.retired_at
     OR NEW.retired_by IS DISTINCT FROM OLD.retired_by OR NEW.retire_reason IS DISTINCT FROM OLD.retire_reason) THEN
    RAISE EXCEPTION 'retiring a knowledge item cannot be undone';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_versions_before_insert BEFORE INSERT ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION knowledge_version_before_insert();
CREATE TRIGGER knowledge_versions_guard BEFORE UPDATE OR DELETE ON knowledge_versions
  FOR EACH ROW EXECUTE FUNCTION knowledge_version_guard();
CREATE TRIGGER knowledge_items_guard BEFORE UPDATE OR DELETE ON knowledge_items
  FOR EACH ROW EXECUTE FUNCTION knowledge_item_guard();
CREATE TRIGGER knowledge_sections_append_only BEFORE UPDATE OR DELETE ON knowledge_sections
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sections ENABLE ROW LEVEL SECURITY;

REVOKE EXECUTE ON FUNCTION knowledge_version_before_insert() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION knowledge_version_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION knowledge_item_guard() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON knowledge_items, knowledge_versions, knowledge_sections FROM anon;
    REVOKE EXECUTE ON FUNCTION knowledge_version_before_insert(), knowledge_version_guard(), knowledge_item_guard() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON knowledge_items, knowledge_versions, knowledge_sections FROM authenticated;
    REVOKE EXECUTE ON FUNCTION knowledge_version_before_insert(), knowledge_version_guard(), knowledge_item_guard() FROM authenticated;
  END IF;
END $$;

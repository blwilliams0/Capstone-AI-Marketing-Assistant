-- Posts, exact-version approval and assisted (manual) posting.
--
-- Integrity is enforced here, not only in the API:
-- * A post version is immutable. Its canonical snapshot and SHA-256 digest are computed by the
--   database, so they cannot be forged.
-- * An approval points at one version and copies that version's digest. Saving a new version
--   automatically supersedes any pending or approved request for the item.
-- * Only an active approver or administrator can decide. Approving something you requested or
--   wrote ("self-approval") is allowed only for administrators and must be flagged explicitly.
-- * A post record can only be created from an approved, current request, and copies its digest.
-- * Approval and posting history (approval_events, post_records) is append-only and written by
--   triggers, so every state change is recorded.

CREATE TABLE content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  UNIQUE (id, restaurant_id),
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);
CREATE INDEX idx_content_items_restaurant ON content_items(restaurant_id, created_at DESC);

CREATE TABLE content_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'facebook', 'email', 'google_business', 'website')),
  audience TEXT NOT NULL CHECK (audience IN ('locals', 'tourists', 'both')),
  angle TEXT NOT NULL DEFAULT '' CHECK (char_length(angle) <= 300),
  caption TEXT NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 10000),
  photo_plan TEXT NOT NULL DEFAULT '' CHECK (char_length(photo_plan) <= 4000),
  scheduled_for TIMESTAMPTZ,
  -- Image upload arrives in M4; the columns exist now so the digest already covers them.
  media_path TEXT CHECK (media_path IS NULL OR char_length(media_path) <= 500),
  media_sha256 TEXT CHECK (media_sha256 IS NULL OR media_sha256 ~ '^[0-9a-f]{64}$'),
  -- Approved knowledge versions this text relies on (checked by trigger: same restaurant).
  knowledge_version_ids UUID[] NOT NULL DEFAULT '{}',
  -- Sources an edit removed because that rule or fact was retired or expired; shown to the approver.
  sources_removed UUID[] NOT NULL DEFAULT '{}',
  origin TEXT NOT NULL CHECK (origin IN ('human', 'ai_draft')),
  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  digest TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (item_id, restaurant_id) REFERENCES content_items(id, restaurant_id) ON DELETE RESTRICT,
  UNIQUE (item_id, version),
  UNIQUE (id, item_id),
  CHECK (cardinality(knowledge_version_ids) <= 50)
);

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  content_version_id UUID NOT NULL,
  digest TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'withdrawn', 'superseded')),
  requested_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_note TEXT CHECK (request_note IS NULL OR char_length(request_note) <= 1000),
  decided_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000),
  self_approved BOOLEAN NOT NULL DEFAULT false,
  -- Who withdrew it, or whose edit/archive superseded it.
  closed_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ,
  FOREIGN KEY (content_version_id, item_id) REFERENCES content_versions(id, item_id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id, restaurant_id) REFERENCES content_items(id, restaurant_id) ON DELETE RESTRICT,
  CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
  CHECK (status NOT IN ('approved', 'rejected', 'changes_requested') OR decided_by IS NOT NULL),
  CHECK (status NOT IN ('pending', 'withdrawn') OR decided_by IS NULL),
  CHECK (status NOT IN ('rejected', 'changes_requested') OR char_length(btrim(coalesce(decision_note, ''))) > 0),
  CHECK ((status IN ('withdrawn', 'superseded')) = (closed_by IS NOT NULL)),
  CHECK ((closed_by IS NULL) = (closed_at IS NULL)),
  CHECK (NOT self_approved OR decided_by IS NOT NULL)
);
-- One open request (waiting, or approved and not yet replaced) per post.
CREATE UNIQUE INDEX uniq_approval_open_per_item ON approval_requests(item_id) WHERE status IN ('pending', 'approved');
CREATE INDEX idx_approval_requests_restaurant_status ON approval_requests(restaurant_id, status);

CREATE TABLE approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  event TEXT NOT NULL CHECK (event IN ('submitted', 'approved', 'self_approved', 'rejected', 'changes_requested', 'withdrawn', 'superseded', 'posted')),
  actor_user_id UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  note TEXT,
  digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_events_restaurant_time ON approval_events(restaurant_id, created_at DESC);
CREATE INDEX idx_approval_events_item ON approval_events(item_id, created_at);

CREATE TABLE post_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL,
  item_id UUID NOT NULL UNIQUE,
  approval_id UUID NOT NULL UNIQUE REFERENCES approval_requests(id) ON DELETE RESTRICT,
  content_version_id UUID NOT NULL,
  digest TEXT NOT NULL DEFAULT '',
  posted_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  post_url TEXT CHECK (post_url IS NULL OR (post_url ~ '^https?://' AND char_length(post_url) <= 2000)),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  FOREIGN KEY (content_version_id, item_id) REFERENCES content_versions(id, item_id) ON DELETE RESTRICT,
  FOREIGN KEY (item_id, restaurant_id) REFERENCES content_items(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_post_records_restaurant_time ON post_records(restaurant_id, posted_at DESC);

-- Each "Draft a post" run, summarised (angle and opening line only), so later drafts can avoid
-- repeating recent ideas. Append-only history.
CREATE TABLE draft_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  audience TEXT NOT NULL,
  goal TEXT NOT NULL CHECK (char_length(goal) <= 300),
  angles JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_draft_generations_restaurant_time ON draft_generations(restaurant_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Helpers

-- True when the user is an active member of the restaurant with one of the given roles.
CREATE FUNCTION member_has_role(p_restaurant UUID, p_user UUID, p_roles TEXT[]) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
     WHERE restaurant_id = p_restaurant AND user_id = p_user AND status = 'active' AND role = ANY(p_roles)
  );
$$ LANGUAGE sql STABLE;

-- True when any of the given knowledge versions is no longer usable: not the approved version,
-- expired, or its item retired. Locks those rows so a concurrent change waits for this check.
CREATE FUNCTION knowledge_is_stale(p_ids UUID[]) RETURNS BOOLEAN AS $$
DECLARE
  v_bad BOOLEAN;
BEGIN
  PERFORM 1 FROM knowledge_versions WHERE id = ANY(p_ids) FOR SHARE;
  SELECT EXISTS (
    SELECT 1 FROM knowledge_versions kv JOIN knowledge_items ki ON ki.id = kv.item_id
     WHERE kv.id = ANY(p_ids)
       AND (kv.status <> 'approved' OR (kv.expires_at IS NOT NULL AND kv.expires_at <= now()) OR ki.retired_at IS NOT NULL)
  ) INTO v_bad;
  RETURN v_bad;
END;
$$ LANGUAGE plpgsql;

-- Everyone who wrote any part of a post: its creator and the author of every version.
CREATE FUNCTION content_authors(p_item UUID) RETURNS UUID[] AS $$
  SELECT ARRAY(
    SELECT created_by FROM content_items WHERE id = p_item
    UNION SELECT created_by FROM content_versions WHERE item_id = p_item
  );
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------------------------
-- content_items: identity fixed; archiving is one-way.

CREATE FUNCTION content_item_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'posts cannot be deleted; archive them instead';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.title IS DISTINCT FROM OLD.title THEN
    RAISE EXCEPTION 'post identity cannot change';
  END IF;
  IF OLD.archived_at IS NOT NULL AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by) THEN
    RAISE EXCEPTION 'archiving a post cannot be undone';
  END IF;
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL AND EXISTS (SELECT 1 FROM post_records WHERE item_id = OLD.id) THEN
    RAISE EXCEPTION 'a published post cannot be archived';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------------------------
-- content_versions: canonical snapshot + digest computed here; editing supersedes approvals.

CREATE FUNCTION content_version_before_insert() RETURNS TRIGGER AS $$
DECLARE
  v_item content_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM content_items WHERE id = NEW.item_id FOR UPDATE;
  IF v_item.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'this post has been archived';
  END IF;
  IF EXISTS (SELECT 1 FROM post_records WHERE item_id = NEW.item_id) THEN
    RAISE EXCEPTION 'this post has already been published; start a new post instead';
  END IF;
  IF NOT member_has_role(NEW.restaurant_id, NEW.created_by, ARRAY['admin', 'approver', 'contributor']) THEN
    RAISE EXCEPTION 'only active staff can write posts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.knowledge_version_ids) AS k(id)
     WHERE NOT EXISTS (SELECT 1 FROM knowledge_versions kv WHERE kv.id = k.id AND kv.restaurant_id = NEW.restaurant_id)
  ) THEN
    RAISE EXCEPTION 'a post can only rely on knowledge from its own restaurant';
  END IF;

  NEW.knowledge_version_ids := ARRAY(SELECT DISTINCT x FROM unnest(NEW.knowledge_version_ids) AS x ORDER BY x);
  NEW.sources_removed := ARRAY(SELECT DISTINCT x FROM unnest(NEW.sources_removed) AS x ORDER BY x);
  NEW.snapshot := jsonb_build_object(
    'item_id', NEW.item_id,
    'version', NEW.version,
    'channel', NEW.channel,
    'audience', NEW.audience,
    'angle', NEW.angle,
    'caption', NEW.caption,
    'photo_plan', NEW.photo_plan,
    'scheduled_for', CASE WHEN NEW.scheduled_for IS NULL THEN NULL
                          ELSE to_char(NEW.scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
    'media_path', NEW.media_path,
    'media_sha256', NEW.media_sha256,
    'knowledge_version_ids', to_jsonb(NEW.knowledge_version_ids),
    'sources_removed', to_jsonb(NEW.sources_removed)
  );
  NEW.digest := encode(sha256(convert_to(NEW.snapshot::text, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A new version means the text changed: any waiting or approved request no longer applies.
CREATE FUNCTION content_version_after_insert() RETURNS TRIGGER AS $$
BEGIN
  UPDATE approval_requests SET status = 'superseded', closed_by = NEW.created_by
   WHERE item_id = NEW.item_id AND status IN ('pending', 'approved');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------------------------
-- approval_requests

CREATE FUNCTION approval_request_before_insert() RETURNS TRIGGER AS $$
DECLARE
  v_version content_versions%ROWTYPE;
  v_latest INTEGER;
BEGIN
  IF NEW.status <> 'pending' OR NEW.decided_by IS NOT NULL OR NEW.self_approved OR NEW.closed_by IS NOT NULL THEN
    RAISE EXCEPTION 'approval requests must start as pending';
  END IF;
  PERFORM 1 FROM content_items WHERE id = NEW.item_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this post has been archived';
  END IF;
  IF EXISTS (SELECT 1 FROM post_records WHERE item_id = NEW.item_id) THEN
    RAISE EXCEPTION 'this post has already been published';
  END IF;
  SELECT * INTO v_version FROM content_versions WHERE id = NEW.content_version_id;
  SELECT max(version) INTO v_latest FROM content_versions WHERE item_id = NEW.item_id;
  IF v_version.version <> v_latest THEN
    RAISE EXCEPTION 'only the latest version of a post can be submitted';
  END IF;
  IF NOT member_has_role(NEW.restaurant_id, NEW.requested_by, ARRAY['admin', 'approver', 'contributor']) THEN
    RAISE EXCEPTION 'only active staff can submit posts';
  END IF;
  NEW.digest := v_version.digest;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION approval_request_guard() RETURNS TRIGGER AS $$
DECLARE
  v_self BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval requests cannot be deleted';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.content_version_id IS DISTINCT FROM OLD.content_version_id OR NEW.digest IS DISTINCT FROM OLD.digest
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.request_note IS DISTINCT FROM OLD.request_note THEN
    RAISE EXCEPTION 'an approval request cannot be changed; submit a new one';
  END IF;

  -- pending -> a decision by an active approver or administrator
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'changes_requested') THEN
    IF NEW.closed_by IS NOT NULL THEN
      RAISE EXCEPTION 'invalid approval change';
    END IF;
    IF NOT member_has_role(NEW.restaurant_id, NEW.decided_by, ARRAY['admin', 'approver']) THEN
      RAISE EXCEPTION 'only an active approver or administrator can decide on a post';
    END IF;
    IF NEW.status = 'approved' THEN
      v_self := NEW.decided_by = NEW.requested_by OR NEW.decided_by = ANY(content_authors(NEW.item_id));
      IF NEW.self_approved IS DISTINCT FROM v_self THEN
        RAISE EXCEPTION 'self-approval must be flagged exactly';
      END IF;
      IF v_self AND NOT member_has_role(NEW.restaurant_id, NEW.decided_by, ARRAY['admin']) THEN
        RAISE EXCEPTION 'only an administrator may approve their own post';
      END IF;
      IF (SELECT max(version) FROM content_versions WHERE item_id = NEW.item_id)
         <> (SELECT version FROM content_versions WHERE id = NEW.content_version_id) THEN
        RAISE EXCEPTION 'only the latest version of a post can be approved';
      END IF;
      IF knowledge_is_stale((SELECT knowledge_version_ids FROM content_versions WHERE id = NEW.content_version_id)) THEN
        RAISE EXCEPTION 'this post relies on knowledge that has changed; update it before approval';
      END IF;
    ELSIF NEW.self_approved THEN
      RAISE EXCEPTION 'invalid approval change';
    END IF;
    NEW.decided_at := now();
    RETURN NEW;
  END IF;

  -- pending -> withdrawn by its requester (or an administrator, checked in the API)
  IF OLD.status = 'pending' AND NEW.status = 'withdrawn' AND NEW.decided_by IS NULL AND NOT NEW.self_approved THEN
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  -- pending/approved -> superseded (an edit or archive), never once posted
  IF OLD.status IN ('pending', 'approved') AND NEW.status = 'superseded'
     AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
     AND NEW.decision_note IS NOT DISTINCT FROM OLD.decision_note AND NEW.self_approved = OLD.self_approved THEN
    IF EXISTS (SELECT 1 FROM post_records WHERE approval_id = OLD.id) THEN
      RAISE EXCEPTION 'a published approval cannot be superseded';
    END IF;
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid approval change (% -> %)', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

-- Every state change of a request is written to approval_events.
CREATE FUNCTION approval_request_record_event() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO approval_events (restaurant_id, approval_id, item_id, event, actor_user_id, note, digest)
    VALUES (NEW.restaurant_id, NEW.id, NEW.item_id, 'submitted', NEW.requested_by, NEW.request_note, NEW.digest);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO approval_events (restaurant_id, approval_id, item_id, event, actor_user_id, note, digest)
    VALUES (
      NEW.restaurant_id, NEW.id, NEW.item_id,
      CASE WHEN NEW.status = 'approved' AND NEW.self_approved THEN 'self_approved' ELSE NEW.status END,
      CASE WHEN NEW.status IN ('withdrawn', 'superseded') THEN NEW.closed_by ELSE NEW.decided_by END,
      CASE WHEN NEW.status IN ('withdrawn', 'superseded') THEN NULL ELSE NEW.decision_note END,
      NEW.digest
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------------------------
-- post_records: only from an approved request for the latest version, by an active staff member.

CREATE FUNCTION post_record_before_insert() RETURNS TRIGGER AS $$
DECLARE
  v_req approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM approval_requests WHERE id = NEW.approval_id FOR UPDATE;
  IF v_req.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'only an approved post can be marked as posted';
  END IF;
  IF v_req.item_id <> NEW.item_id OR v_req.content_version_id <> NEW.content_version_id OR v_req.restaurant_id <> NEW.restaurant_id THEN
    RAISE EXCEPTION 'post record does not match its approval';
  END IF;
  IF NOT member_has_role(NEW.restaurant_id, NEW.posted_by, ARRAY['admin', 'approver', 'contributor']) THEN
    RAISE EXCEPTION 'only active staff can record a post';
  END IF;
  PERFORM 1 FROM content_items WHERE id = NEW.item_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this post has been archived';
  END IF;
  IF knowledge_is_stale((SELECT knowledge_version_ids FROM content_versions WHERE id = NEW.content_version_id)) THEN
    RAISE EXCEPTION 'this post relies on knowledge that has changed; update it before posting';
  END IF;
  NEW.digest := v_req.digest;
  NEW.posted_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION post_record_after_insert() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO approval_events (restaurant_id, approval_id, item_id, event, actor_user_id, note, digest)
  VALUES (NEW.restaurant_id, NEW.approval_id, NEW.item_id, 'posted', NEW.posted_by, NEW.note, NEW.digest);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------------------------
-- Triggers

CREATE TRIGGER content_items_guard BEFORE UPDATE OR DELETE ON content_items
  FOR EACH ROW EXECUTE FUNCTION content_item_guard();
CREATE TRIGGER content_versions_before_insert BEFORE INSERT ON content_versions
  FOR EACH ROW EXECUTE FUNCTION content_version_before_insert();
CREATE TRIGGER content_versions_after_insert AFTER INSERT ON content_versions
  FOR EACH ROW EXECUTE FUNCTION content_version_after_insert();
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER approval_requests_before_insert BEFORE INSERT ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_request_before_insert();
CREATE TRIGGER approval_requests_guard BEFORE UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_request_guard();
CREATE TRIGGER approval_requests_record_event AFTER INSERT OR UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_request_record_event();
CREATE TRIGGER approval_events_append_only BEFORE UPDATE OR DELETE ON approval_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER post_records_before_insert BEFORE INSERT ON post_records
  FOR EACH ROW EXECUTE FUNCTION post_record_before_insert();
CREATE TRIGGER post_records_after_insert AFTER INSERT ON post_records
  FOR EACH ROW EXECUTE FUNCTION post_record_after_insert();
CREATE TRIGGER post_records_append_only BEFORE UPDATE OR DELETE ON post_records
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER draft_generations_append_only BEFORE UPDATE OR DELETE ON draft_generations
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ---------------------------------------------------------------------------------------------
-- Lock down: the API connects as the database owner; the public Data API roles get nothing.

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_generations ENABLE ROW LEVEL SECURITY;

-- Pin name resolution so no function can be steered through another schema on the search path.
ALTER FUNCTION member_has_role(UUID, UUID, TEXT[]) SET search_path = public, pg_temp;
ALTER FUNCTION knowledge_is_stale(UUID[]) SET search_path = public, pg_temp;
ALTER FUNCTION content_authors(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION content_item_guard() SET search_path = public, pg_temp;
ALTER FUNCTION content_version_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION content_version_after_insert() SET search_path = public, pg_temp;
ALTER FUNCTION approval_request_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION approval_request_guard() SET search_path = public, pg_temp;
ALTER FUNCTION approval_request_record_event() SET search_path = public, pg_temp;
ALTER FUNCTION post_record_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION post_record_after_insert() SET search_path = public, pg_temp;

-- Covers every function that exists now; later migrations must repeat this for new functions
-- (the migrations test checks that no public role can execute any function).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON content_items, content_versions, approval_requests, approval_events, post_records, draft_generations FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON content_items, content_versions, approval_requests, approval_events, post_records, draft_generations FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

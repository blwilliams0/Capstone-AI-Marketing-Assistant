-- Approving or rejecting brand knowledge is for active administrators only. The API already
-- enforces this (brand.approve); this makes the database enforce it too, like post approvals.
-- Same rules as migration 003's knowledge_version_guard, plus the decider check.

CREATE OR REPLACE FUNCTION knowledge_version_guard() RETURNS TRIGGER AS $$
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
    IF NOT member_has_role(NEW.restaurant_id, NEW.decided_by, ARRAY['admin']) THEN
      RAISE EXCEPTION 'only an active administrator can approve or reject brand knowledge';
    END IF;
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

ALTER FUNCTION knowledge_version_guard() SET search_path = public, pg_temp;

-- Faster lookups of a post's approval history and of requests for one version.
CREATE INDEX IF NOT EXISTS idx_approval_requests_item ON approval_requests(item_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_version ON approval_requests(content_version_id);

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
  END IF;
END $$;

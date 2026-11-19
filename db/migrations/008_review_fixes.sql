-- Fixes from the M4 security review (migrations 006 and 007 are already applied, so they are not edited).

-- 1. Lock the interview row while checking it, so an answer cannot slip in just after the interview
--    is completed, and a stored AI suggestion cannot slip in just after consent is withdrawn.
CREATE OR REPLACE FUNCTION interview_answer_before_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM interview_sessions WHERE id = NEW.session_id AND status = 'in_progress' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this interview is completed; answers can no longer be added';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION interview_extraction_before_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM interview_sessions WHERE id = NEW.session_id AND ai_consent FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the interviewee did not agree to AI processing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION interview_answer_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION interview_extraction_before_insert() SET search_path = public, pg_temp;

-- 2. Reminder links: an in-app path whose first segment is a name (never "//host").
ALTER TABLE notifications DROP CONSTRAINT notifications_link_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_link_check
  CHECK ((link = '/' OR link ~ '^/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$') AND char_length(link) <= 200);

-- CREATE OR REPLACE keeps existing grants, but re-assert the lockdown for safety.
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

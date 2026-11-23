-- Interviews: a name and a practice flag (both can be changed), uploaded transcripts, and answers
-- filled from a transcript (marked as such, linked to the transcript they came from).

ALTER TABLE interview_sessions
  ADD COLUMN label TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  -- Practice interviews are kept but never used to compare managers' views.
  ADD COLUMN is_practice BOOLEAN NOT NULL DEFAULT false;

-- Same rules as before, except the name and the practice flag may change.
CREATE OR REPLACE FUNCTION interview_session_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interviews cannot be deleted';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.interviewee_name IS DISTINCT FROM OLD.interviewee_name
     OR NEW.interviewee_role IS DISTINCT FROM OLD.interviewee_role OR NEW.notes_consent IS DISTINCT FROM OLD.notes_consent
     OR NEW.conducted_by IS DISTINCT FROM OLD.conducted_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'interview details cannot change';
  END IF;
  IF NEW.ai_consent AND NOT OLD.ai_consent THEN
    RAISE EXCEPTION 'AI consent cannot be added after the interview started';
  END IF;
  IF OLD.status = 'completed' AND (NEW.status <> 'completed' OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.completed_by IS DISTINCT FROM OLD.completed_by) THEN
    RAISE EXCEPTION 'a completed interview cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE interview_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  file_name TEXT CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 150000),
  sha256 TEXT NOT NULL DEFAULT '',
  uploaded_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, session_id),
  FOREIGN KEY (session_id, restaurant_id) REFERENCES interview_sessions(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_interview_transcripts_session ON interview_transcripts(session_id, created_at DESC);

ALTER TABLE interview_answers
  ADD COLUMN source TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'transcript')),
  ADD COLUMN transcript_id UUID,
  ADD CONSTRAINT interview_answers_transcript_fk FOREIGN KEY (transcript_id, session_id)
    REFERENCES interview_transcripts(id, session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT interview_answers_transcript_link_check CHECK ((source = 'transcript') = (transcript_id IS NOT NULL));

-- The transcript's fingerprint is computed here; transcripts can only be added to open interviews.
CREATE FUNCTION interview_transcript_before_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM interview_sessions WHERE id = NEW.session_id AND status = 'in_progress' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this interview is completed; transcripts can no longer be added';
  END IF;
  NEW.sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER interview_transcripts_before_insert BEFORE INSERT ON interview_transcripts
  FOR EACH ROW EXECUTE FUNCTION interview_transcript_before_insert();
CREATE TRIGGER interview_transcripts_append_only BEFORE UPDATE OR DELETE ON interview_transcripts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER FUNCTION interview_session_guard() SET search_path = public, pg_temp;
ALTER FUNCTION interview_transcript_before_insert() SET search_path = public, pg_temp;

ALTER TABLE interview_transcripts ENABLE ROW LEVEL SECURITY;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON interview_transcripts FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON interview_transcripts FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

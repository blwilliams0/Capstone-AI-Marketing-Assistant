-- Brand interviews with management. Answers are kept verbatim and append-only (a correction is a
-- new row; the latest row per question wins). The AI may only read answers when the interviewee
-- agreed (ai_consent), and it can only ever produce PROPOSALS in the knowledge library.

CREATE TABLE interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  interviewee_name TEXT NOT NULL CHECK (char_length(interviewee_name) BETWEEN 1 AND 120),
  interviewee_role TEXT CHECK (interviewee_role IS NULL OR char_length(interviewee_role) <= 120),
  notes_consent BOOLEAN NOT NULL CHECK (notes_consent),
  ai_consent BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  conducted_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  UNIQUE (id, restaurant_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((completed_at IS NULL) = (completed_by IS NULL))
);
CREATE INDEX idx_interview_sessions_restaurant ON interview_sessions(restaurant_id, created_at DESC);

CREATE TABLE interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  session_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  question_id TEXT NOT NULL CHECK (question_id ~ '^[A-H][0-9](\.f[1-9])?$'),
  question_text TEXT NOT NULL CHECK (char_length(question_text) BETWEEN 1 AND 1000),
  answer TEXT NOT NULL CHECK (char_length(answer) <= 8000),
  recorded_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, restaurant_id) REFERENCES interview_sessions(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_interview_answers_session ON interview_answers(session_id, question_id, seq);

-- What the AI suggested from an interview (validated by the server before storing).
CREATE TABLE interview_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  result JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, session_id),
  FOREIGN KEY (session_id, restaurant_id) REFERENCES interview_sessions(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_interview_extractions_session ON interview_extractions(session_id, created_at DESC);

-- Which suggestions a person saved to the knowledge library (always as proposals).
CREATE TABLE interview_proposal_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id UUID NOT NULL REFERENCES interview_extractions(id) ON DELETE RESTRICT,
  proposal_index INTEGER NOT NULL CHECK (proposal_index >= 0),
  knowledge_item_id UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE RESTRICT,
  knowledge_version_id UUID NOT NULL REFERENCES knowledge_versions(id) ON DELETE RESTRICT,
  saved_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (extraction_id, proposal_index)
);

CREATE FUNCTION interview_session_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'interviews cannot be deleted';
  END IF;
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id OR NEW.interviewee_name IS DISTINCT FROM OLD.interviewee_name
     OR NEW.interviewee_role IS DISTINCT FROM OLD.interviewee_role OR NEW.notes_consent IS DISTINCT FROM OLD.notes_consent
     OR NEW.conducted_by IS DISTINCT FROM OLD.conducted_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'interview details cannot change';
  END IF;
  -- Consent to AI use can be withdrawn, never granted after the fact.
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

CREATE FUNCTION interview_answer_before_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM interview_sessions WHERE id = NEW.session_id AND status = 'in_progress';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this interview is completed; answers can no longer be added';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION interview_extraction_before_insert() RETURNS TRIGGER AS $$
BEGIN
  PERFORM 1 FROM interview_sessions WHERE id = NEW.session_id AND ai_consent;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the interviewee did not agree to AI processing';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER interview_sessions_guard BEFORE UPDATE OR DELETE ON interview_sessions
  FOR EACH ROW EXECUTE FUNCTION interview_session_guard();
CREATE TRIGGER interview_answers_before_insert BEFORE INSERT ON interview_answers
  FOR EACH ROW EXECUTE FUNCTION interview_answer_before_insert();
CREATE TRIGGER interview_answers_append_only BEFORE UPDATE OR DELETE ON interview_answers
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER interview_extractions_before_insert BEFORE INSERT ON interview_extractions
  FOR EACH ROW EXECUTE FUNCTION interview_extraction_before_insert();
CREATE TRIGGER interview_extractions_append_only BEFORE UPDATE OR DELETE ON interview_extractions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER interview_proposal_saves_append_only BEFORE UPDATE OR DELETE ON interview_proposal_saves
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER FUNCTION interview_session_guard() SET search_path = public, pg_temp;
ALTER FUNCTION interview_answer_before_insert() SET search_path = public, pg_temp;
ALTER FUNCTION interview_extraction_before_insert() SET search_path = public, pg_temp;

ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_proposal_saves ENABLE ROW LEVEL SECURITY;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON interview_sessions, interview_answers, interview_extractions, interview_proposal_saves FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON interview_sessions, interview_answers, interview_extractions, interview_proposal_saves FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

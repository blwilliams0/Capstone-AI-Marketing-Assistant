-- In-app reminders (no email or text messages: no paid services). Created by the reminder scan,
-- which is idempotent through (recipient, dedupe_key). Only "read" can change, once.

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  recipient_user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('post_due', 'post_overdue', 'post_not_submitted', 'approval_waiting', 'fact_expiring', 'fact_expired')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT NOT NULL CHECK (char_length(body) <= 1000),
  -- An in-app path only (never an external link).
  link TEXT NOT NULL CHECK (link ~ '^/[A-Za-z0-9/_-]*$' AND char_length(link) <= 200),
  dedupe_key TEXT NOT NULL CHECK (char_length(dedupe_key) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE (recipient_user_id, dedupe_key)
);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id, created_at DESC);

CREATE FUNCTION notification_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'notifications cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.link IS DISTINCT FROM OLD.link
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
    RAISE EXCEPTION 'only marking a notification as read is allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notifications_guard BEFORE UPDATE OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notification_guard();
ALTER FUNCTION notification_guard() SET search_path = public, pg_temp;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON notifications FROM anon;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON notifications FROM authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

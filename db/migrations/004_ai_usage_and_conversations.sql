-- AI usage and cost tracking (no prompt text is stored here) and assistant conversations.
-- Conversations are working history, never authoritative knowledge.

CREATE TABLE ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES profiles(user_id) ON DELETE RESTRICT,
  task TEXT NOT NULL CHECK (task IN ('answer', 'draft', 'interview', 'extract')),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'mock')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  -- Estimated from published prices; the provider's invoice is authoritative.
  cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'error', 'blocked_budget')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_restaurant_time ON ai_usage_events(restaurant_id, created_at);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, restaurant_id)
);
CREATE INDEX idx_conversations_user ON conversations(restaurant_id, user_id, created_at DESC);

CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Insertion order. Timestamps alone cannot order two messages written in one transaction.
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  conversation_id UUID NOT NULL,
  restaurant_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 40000),
  -- For assistant messages: the approved knowledge versions the answer cited.
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (conversation_id, restaurant_id) REFERENCES conversations(id, restaurant_id) ON DELETE RESTRICT
);
CREATE INDEX idx_conversation_messages_conv ON conversation_messages(conversation_id, seq);

CREATE TRIGGER ai_usage_events_append_only BEFORE UPDATE OR DELETE ON ai_usage_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER conversation_messages_append_only BEFORE UPDATE OR DELETE ON conversation_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ai_usage_events, conversations, conversation_messages FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ai_usage_events, conversations, conversation_messages FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Restaurants table
CREATE TABLE restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default restaurant
INSERT INTO restaurants (id, name, description)
VALUES ('00000000-0000-0000-0000-000000000001', 'The Pocket', 'Upscale Carmel-by-the-Sea restaurant')
ON CONFLICT DO NOTHING;

-- Profiles table (links Supabase auth users to restaurant)
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'contributor', 'viewer')),
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand interviews
CREATE TABLE brand_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL CHECK (category IN ('voice', 'hospitality', 'menu', 'photography', 'banned_claims')),
  content JSONB NOT NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  source_documents TEXT[],
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brand rules
CREATE TABLE brand_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('voice', 'hospitality', 'menu', 'photography', 'banned_claims')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verified facts
CREATE TABLE verified_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('hours', 'menu', 'policy', 'venue_description')),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  verified_by UUID,
  expires_at TIMESTAMPTZ,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(category, key)
);

-- Marketing strategies
CREATE TABLE marketing_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge sources
CREATE TABLE knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source_url TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID,
  type TEXT NOT NULL CHECK (type IN ('upload', 'web_scrape', 'research_paper', 'open_textbook')),
  license_info TEXT,
  approved_for_ingestion BOOLEAN NOT NULL DEFAULT false,
  ingestion_metadata JSONB,
  raw_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Campaigns
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  created_by UUID NOT NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  payload JSONB NOT NULL,
  scheduled_for TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Content revisions
CREATE TABLE content_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('caption', 'image', 'video')),
  content_data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, content_type, version)
);

-- Approval requests
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type TEXT NOT NULL CHECK (request_type IN ('publish', 'brand_change', 'permission_change', 'content_draft')),
  requested_by UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'expired')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  payload_snapshot JSONB NOT NULL,
  context_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit events (append-only)
CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL,
  ip_address INET,
  user_agent TEXT
);

-- Indexes
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_brand_rules_approved ON brand_rules(approved_at);
CREATE INDEX idx_verified_facts_category ON verified_facts(category);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_scheduled_for ON campaigns(scheduled_for);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
CREATE INDEX idx_audit_events_timestamp ON audit_events(timestamp DESC);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS 
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
 LANGUAGE plpgsql;

CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON brand_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_facts_updated_at BEFORE UPDATE ON verified_facts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_strategies_updated_at BEFORE UPDATE ON marketing_strategies FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();

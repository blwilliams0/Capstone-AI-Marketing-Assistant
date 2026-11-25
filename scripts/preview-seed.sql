BEGIN;

INSERT INTO restaurants (id, name)
VALUES ('00000000-0000-0000-0000-00000000d3a0', 'The Pocket (practice workspace)')
ON CONFLICT DO NOTHING;

WITH mock_users AS (
  SELECT ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid AS id, role
  FROM unnest(ARRAY['admin', 'approver', 'contributor', 'viewer']) WITH ORDINALITY AS roles(role, n)
)
INSERT INTO auth.users (id, email)
SELECT id, 'mock-' || role || '@example.invalid' FROM mock_users
ON CONFLICT DO NOTHING;

INSERT INTO profiles (user_id, email, name)
SELECT id, email, 'Mock ' || split_part(split_part(email, '@', 1), '-', 2)
FROM auth.users WHERE email IN ('mock-admin@example.invalid', 'mock-approver@example.invalid', 'mock-contributor@example.invalid', 'mock-viewer@example.invalid')
ON CONFLICT DO NOTHING;

INSERT INTO memberships (restaurant_id, user_id, role)
SELECT '00000000-0000-0000-0000-00000000d3a0', user_id, split_part(split_part(email, '@', 1), '-', 2)
FROM profiles WHERE email IN ('mock-admin@example.invalid', 'mock-approver@example.invalid', 'mock-contributor@example.invalid', 'mock-viewer@example.invalid')
ON CONFLICT DO NOTHING;

COMMIT;

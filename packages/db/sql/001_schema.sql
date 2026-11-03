-- Election Platform — Central Server Module schema
-- Every tenant-scoped table carries a denormalized tenant_id and an RLS policy
-- restricting rows to current_setting('app.tenant_id'). FORCE ROW LEVEL SECURITY
-- ensures the policy applies even to the table owner (the app's own DB role),
-- which is what makes the RLS tests in packages/db/test meaningful.

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  fcm_credential_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS elections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text,
  election_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mohafazats (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  election_id uuid NOT NULL REFERENCES elections(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS qadas (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  mohafazat_id uuid NOT NULL REFERENCES mohafazats(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS voting_centers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  qada_id uuid NOT NULL REFERENCES qadas(id),
  name text NOT NULL,
  address text,
  geo_lat double precision,
  geo_lng double precision
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  voting_center_id uuid NOT NULL REFERENCES voting_centers(id),
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS room_registry_ranges (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  registry_range_start bigint NOT NULL,
  registry_range_end bigint NOT NULL,
  CHECK (registry_range_end >= registry_range_start)
);

CREATE TABLE IF NOT EXISTS family_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  registry_number bigint NOT NULL,
  room_id uuid REFERENCES rooms(id),
  UNIQUE (tenant_id, registry_number)
);

CREATE TABLE IF NOT EXISTS voter_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  family_record_id uuid NOT NULL REFERENCES family_records(id),
  name text NOT NULL,
  disambiguation jsonb
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'campaign_admin', 'coordinator', 'analyst', 'delegate')),
  phone text,
  email text,
  auth_method text NOT NULL CHECK (auth_method IN ('otp', 'password_totp')),
  password_hash text,
  totp_secret text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delegate_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  delegate_id uuid NOT NULL REFERENCES users(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  assignment_role text NOT NULL DEFAULT 'primary',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz
);

CREATE TABLE IF NOT EXISTS device_credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  delegate_id uuid NOT NULL REFERENCES users(id),
  device_id text NOT NULL,
  credential_type text NOT NULL CHECK (credential_type IN ('token', 'cert')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  connected boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz
);

CREATE TABLE IF NOT EXISTS voter_checkins (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  voter_record_id uuid NOT NULL REFERENCES voter_records(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  checked_in_by uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL,
  client_uuid uuid NOT NULL,
  reverted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS turnout_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  occurred_at timestamptz NOT NULL,
  count integer NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  client_uuid uuid NOT NULL,
  publish_status text NOT NULL DEFAULT 'published',
  UNIQUE (tenant_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS tally_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  candidate_list_id text NOT NULL,
  count integer NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id),
  co_confirmed_by uuid REFERENCES users(id),
  official_tally_photo_ref text,
  client_uuid uuid NOT NULL,
  UNIQUE (tenant_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS irregularities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  description text,
  media_refs jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'resolved')),
  assigned_to uuid REFERENCES users(id),
  client_uuid uuid NOT NULL,
  UNIQUE (tenant_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  from_user_id uuid REFERENCES users(id),
  to_type text NOT NULL CHECK (to_type IN ('user', 'role', 'broadcast_room', 'broadcast_qada')),
  to_ref text,
  body text NOT NULL,
  ack_status text NOT NULL DEFAULT 'sent' CHECK (ack_status IN ('sent', 'delivered', 'acknowledged')),
  client_uuid uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Postgres treats each NULL as distinct for uniqueness purposes, so HQ
  -- broadcasts (created directly by command-api, client_uuid left null)
  -- never collide here -- this constraint only dedupes delegate-originated
  -- messages/out publishes, which always carry a real client_uuid.
  UNIQUE (tenant_id, client_uuid)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_ref text NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Row-Level Security: tenant isolation
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'elections','mohafazats','qadas','voting_centers','rooms','room_registry_ranges',
    'family_records','voter_records','users','delegate_assignments','device_credentials',
    'voter_checkins','turnout_entries','tally_entries','irregularities','messages','audit_logs'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    -- NULLIF(..., '') matters: once `app.tenant_id` has been SET LOCAL at least
    -- once in a session, Postgres resets the placeholder to '' (not NULL) when
    -- that LOCAL scope ends, and ''::uuid raises an error rather than failing
    -- the comparison safely. NULLIF coerces that back to NULL first, so a
    -- session with no tenant currently scoped just sees zero rows, cleanly.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;

-- IMPORTANT: a Postgres superuser bypasses RLS entirely, FORCE or not -- these
-- policies are only meaningful if application code runs as a non-superuser role.
-- Migrations/DDL run as the default (superuser) role; the app itself must connect
-- as `app_user`. In this dev/test environment (PGlite, a single embedded session)
-- packages/db/src/client.ts issues `SET ROLE app_user` right after migrations.
-- In a real deployment, the app's connection string should authenticate as a
-- least-privileged `app_user` credential from the start (migrations run
-- separately, as an admin credential -- see docs/DEPLOYMENT.md CI/CD section).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

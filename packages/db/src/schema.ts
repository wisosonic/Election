import {
  pgTable,
  uuid,
  text,
  timestamp,
  date,
  bigint,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  unique,
} from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  fcmCredentialRef: text('fcm_credential_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const elections = pgTable('elections', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name'),
  electionDate: date('election_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const mohafazats = pgTable('mohafazats', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  electionId: uuid('election_id').notNull(),
  name: text('name').notNull(),
});

export const qadas = pgTable('qadas', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  mohafazatId: uuid('mohafazat_id').notNull(),
  name: text('name').notNull(),
});

export const votingCenters = pgTable('voting_centers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  qadaId: uuid('qada_id').notNull(),
  name: text('name').notNull(),
  address: text('address'),
  geoLat: doublePrecision('geo_lat'),
  geoLng: doublePrecision('geo_lng'),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  votingCenterId: uuid('voting_center_id').notNull(),
  label: text('label').notNull(),
});

export const roomRegistryRanges = pgTable('room_registry_ranges', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  roomId: uuid('room_id').notNull(),
  registryRangeStart: bigint('registry_range_start', { mode: 'number' }).notNull(),
  registryRangeEnd: bigint('registry_range_end', { mode: 'number' }).notNull(),
});

export const familyRecords = pgTable(
  'family_records',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    registryNumber: bigint('registry_number', { mode: 'number' }).notNull(),
    roomId: uuid('room_id'),
  },
  (t) => ({
    tenantRegistryUnique: unique().on(t.tenantId, t.registryNumber),
  }),
);

export const voterRecords = pgTable('voter_records', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  familyRecordId: uuid('family_record_id').notNull(),
  name: text('name').notNull(),
  disambiguation: jsonb('disambiguation'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  role: text('role').notNull(),
  phone: text('phone'),
  email: text('email'),
  authMethod: text('auth_method').notNull(),
  passwordHash: text('password_hash'),
  totpSecret: text('totp_secret'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const delegateAssignments = pgTable('delegate_assignments', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  delegateId: uuid('delegate_id').notNull(),
  roomId: uuid('room_id').notNull(),
  assignmentRole: text('assignment_role').notNull().default('primary'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp('unassigned_at', { withTimezone: true }),
});

export const deviceCredentials = pgTable('device_credentials', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  delegateId: uuid('delegate_id').notNull(),
  deviceId: text('device_id').notNull(),
  credentialType: text('credential_type').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  connected: boolean('connected').notNull().default(false),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

export const voterCheckins = pgTable(
  'voter_checkins',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    voterRecordId: uuid('voter_record_id').notNull(),
    roomId: uuid('room_id').notNull(),
    checkedInBy: uuid('checked_in_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    clientUuid: uuid('client_uuid').notNull(),
    reverted: boolean('reverted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantClientUuidUnique: unique().on(t.tenantId, t.clientUuid),
  }),
);

export const turnoutEntries = pgTable(
  'turnout_entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    roomId: uuid('room_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    count: integer('count').notNull(),
    submittedBy: uuid('submitted_by').notNull(),
    clientUuid: uuid('client_uuid').notNull(),
    publishStatus: text('publish_status').notNull().default('published'),
  },
  (t) => ({
    tenantClientUuidUnique: unique().on(t.tenantId, t.clientUuid),
  }),
);

export const tallyEntries = pgTable(
  'tally_entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    roomId: uuid('room_id').notNull(),
    candidateListId: text('candidate_list_id').notNull(),
    count: integer('count').notNull(),
    submittedBy: uuid('submitted_by').notNull(),
    coConfirmedBy: uuid('co_confirmed_by'),
    officialTallyPhotoRef: text('official_tally_photo_ref'),
    clientUuid: uuid('client_uuid').notNull(),
  },
  (t) => ({
    tenantClientUuidUnique: unique().on(t.tenantId, t.clientUuid),
  }),
);

export const irregularities = pgTable(
  'irregularities',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    roomId: uuid('room_id').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    description: text('description'),
    mediaRefs: jsonb('media_refs'),
    status: text('status').notNull().default('new'),
    assignedTo: uuid('assigned_to'),
    clientUuid: uuid('client_uuid').notNull(),
  },
  (t) => ({
    tenantClientUuidUnique: unique().on(t.tenantId, t.clientUuid),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    threadId: uuid('thread_id').notNull(),
    fromUserId: uuid('from_user_id'),
    toType: text('to_type').notNull(),
    toRef: text('to_ref'),
    body: text('body').notNull(),
    ackStatus: text('ack_status').notNull().default('sent'),
    clientUuid: uuid('client_uuid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantClientUuidUnique: unique().on(t.tenantId, t.clientUuid),
  }),
);

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityRef: text('entity_ref').notNull(),
  prevHash: text('prev_hash'),
  hash: text('hash').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

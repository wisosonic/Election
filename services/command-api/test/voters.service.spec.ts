import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { createDb, Db, schema, withTenant } from '@election/db';
import { AccessTokenClaims } from '@election/auth';
import { VotersService } from '../src/voters/voters.service';

describe('VotersService', () => {
  let db: Db;
  let close: () => Promise<void>;
  let voters: VotersService;
  let tenantId: string;
  let roomA: string;
  let roomB: string;
  let actorId: string;

  beforeAll(async () => {
    ({ db, close } = await createDb());
    voters = new VotersService(db);

    tenantId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Test Campaign' });

    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    roomA = randomUUID();
    roomB = randomUUID();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'M' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Q' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Center' });
      await tx.insert(schema.rooms).values([
        { id: roomA, tenantId, votingCenterId: centerId, label: 'Room A' },
        { id: roomB, tenantId, votingCenterId: centerId, label: 'Room B' },
      ]);
      actorId = randomUUID();
      await tx.insert(schema.users).values({ id: actorId, tenantId, role: 'campaign_admin', email: 'actor@test.example', authMethod: 'password_totp' });
    });

    await voters.importRegistry(
      tenantId,
      [
        { roomId: roomA, start: 1000, end: 1999 },
        { roomId: roomB, start: 2000, end: 2999 },
      ],
      [
        { registryNumber: 1500, members: [{ name: 'Room A Voter 1' }, { name: 'Room A Voter 2' }] },
        { registryNumber: 2500, members: [{ name: 'Room B Voter 1' }] },
      ],
    );
  });

  afterAll(async () => {
    await close();
  });

  function claims(overrides: Partial<AccessTokenClaims>): AccessTokenClaims {
    return { sub: actorId, tenantId, role: 'campaign_admin', ...overrides };
  }

  it('resolves each family to the correct room by registry range at import time', async () => {
    const list = await voters.getRoomVoters(tenantId, claims({ role: 'campaign_admin' }), roomA);
    expect(list.map((v) => v.name).sort()).toEqual(['Room A Voter 1', 'Room A Voter 2']);
  });

  it('a delegate can read their own assigned room', async () => {
    const list = await voters.getRoomVoters(tenantId, claims({ role: 'delegate', roomIds: [roomA] }), roomA);
    expect(list).toHaveLength(2);
  });

  it("a delegate cannot read another room's voter list, even in the same tenant", async () => {
    await expect(voters.getRoomVoters(tenantId, claims({ role: 'delegate', roomIds: [roomA] }), roomB)).rejects.toThrow();
  });

  it('an analyst is refused raw voter records entirely, regardless of room', async () => {
    await expect(voters.getRoomVoters(tenantId, claims({ role: 'analyst' }), roomA)).rejects.toThrow();
  });

  it('every successful voter-list read is audit-logged (§6.4)', async () => {
    const before = await withTenant(db, tenantId, (tx) => tx.select().from(schema.auditLogs));
    await voters.getRoomVoters(tenantId, claims({ role: 'coordinator' }), roomA);
    const after = await withTenant(db, tenantId, (tx) => tx.select().from(schema.auditLogs));
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1].action).toBe('voter_list.read');
  });

  it('an analyst CAN see the aggregate GOTV view (counts only, no names)', async () => {
    const checkedInById = randomUUID();
    await withTenant(db, tenantId, (tx) =>
      tx.insert(schema.users).values({ id: checkedInById, tenantId, role: 'delegate', phone: '+96170000001', authMethod: 'otp' }),
    );

    const [voter] = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ id: schema.voterRecords.id })
        .from(schema.voterRecords)
        .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
        .where(eq(schema.familyRecords.roomId, roomA))
        .limit(1),
    );

    await withTenant(db, tenantId, (tx) =>
      tx.insert(schema.voterCheckins).values({
        id: randomUUID(),
        tenantId,
        voterRecordId: voter.id,
        roomId: roomA,
        checkedInBy: checkedInById,
        occurredAt: new Date(),
        clientUuid: randomUUID(),
      }),
    );

    const aggregate = await voters.gotvAggregateForRoom(tenantId, roomA);
    expect(aggregate.total).toBe(2);
    expect(aggregate.votedCount).toBe(1);
    expect(aggregate.notYetVoted).toBe(1);
  });
});

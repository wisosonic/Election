import { randomUUID } from 'crypto';
import { createDb, withTenant, schema, Db } from '../src';
import { eq } from 'drizzle-orm';

describe('schema validation', () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenantId: string;

  beforeAll(async () => {
    ({ db, close } = await createDb());
    tenantId = randomUUID();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme Campaign' });
  });

  afterAll(async () => {
    await close();
  });

  it('persists the full geographic hierarchy and reads it back', async () => {
    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    const roomId = randomUUID();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'Mount Lebanon' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Baabda' });
      await tx.insert(schema.votingCenters).values({
        id: centerId,
        tenantId,
        qadaId,
        name: 'Baabda Public School',
        address: 'Main St, Baabda',
      });
      await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: 'Room 3' });
    });

    const room = await withTenant(db, tenantId, (tx) =>
      tx.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)),
    );
    expect(room).toHaveLength(1);
    expect(room[0].label).toBe('Room 3');
  });

  it('rejects a room referencing a non-existent voting center (FK constraint)', async () => {
    await expect(
      withTenant(db, tenantId, (tx) =>
        tx.insert(schema.rooms).values({ id: randomUUID(), tenantId, votingCenterId: randomUUID(), label: 'Ghost Room' }),
      ),
    ).rejects.toThrow();
  });

  it('resolves a family record to a room via registry-number range at import time', async () => {
    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    const roomId = randomUUID();
    const familyId = randomUUID();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'Beirut' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Beirut I' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Beirut School' });
      await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: 'Room 1' });
      await tx.insert(schema.roomRegistryRanges).values({
        id: randomUUID(),
        tenantId,
        roomId,
        registryRangeStart: 1000,
        registryRangeEnd: 2000,
      });
      // Import-time resolution: registry_number 1500 falls in [1000, 2000] -> room_id set directly.
      await tx.insert(schema.familyRecords).values({ id: familyId, tenantId, registryNumber: 1500, roomId });
      await tx.insert(schema.voterRecords).values({
        id: randomUUID(),
        tenantId,
        familyRecordId: familyId,
        name: 'Jean Dupont',
        disambiguation: { fatherName: 'Michel' },
      });
    });

    const voters = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ name: schema.voterRecords.name })
        .from(schema.voterRecords)
        .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
        .where(eq(schema.familyRecords.roomId, roomId)),
    );
    expect(voters.map((v) => v.name)).toEqual(['Jean Dupont']);
  });

  it('enforces client_uuid idempotency via the unique constraint (tenant_id, client_uuid)', async () => {
    const electionId = randomUUID();
    const mohafazatId = randomUUID();
    const qadaId = randomUUID();
    const centerId = randomUUID();
    const roomId = randomUUID();
    const delegateId = randomUUID();
    const clientUuid = randomUUID();

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'South' });
      await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Sour' });
      await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Sour School' });
      await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: 'Room 5' });
      await tx.insert(schema.users).values({ id: delegateId, tenantId, role: 'delegate', phone: '+96170000000', authMethod: 'otp' });
      await tx.insert(schema.turnoutEntries).values({
        id: randomUUID(),
        tenantId,
        roomId,
        occurredAt: new Date(),
        count: 42,
        submittedBy: delegateId,
        clientUuid,
      });
    });

    await expect(
      withTenant(db, tenantId, (tx) =>
        tx.insert(schema.turnoutEntries).values({
          id: randomUUID(),
          tenantId,
          roomId,
          occurredAt: new Date(),
          count: 43,
          submittedBy: delegateId,
          clientUuid, // same client_uuid: a resend, must not create a second row
        }),
      ),
    ).rejects.toThrow();
  });
});

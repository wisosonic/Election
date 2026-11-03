import { eq } from 'drizzle-orm';
import { createDb, Db, schema, withTenant } from '@election/db';
import { assertSeedAllowed } from '../seed/guard';
import { runSeed } from '../seed/generate';

describe('seed generator prod-guard', () => {
  it('refuses to run when NODE_ENV=production', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'production' })).toThrow();
  });

  it('runs fine when NODE_ENV is not production', () => {
    expect(() => assertSeedAllowed({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });
});

describe('runSeed', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createDb());
  });

  afterAll(async () => {
    await close();
  });

  it('produces the full hierarchy with the requested shape and resolves voters into their rooms', async () => {
    const result = await runSeed(db, {
      seed: 7,
      mohafazatCount: 1,
      qadasPerMohafazat: 2,
      centersPerQada: 2,
      roomsPerCenter: 2,
      familiesPerRoom: 3,
    });

    // 1 * 2 * 2 * 2 = 8 rooms, one delegate each.
    expect(result.roomIds).toHaveLength(8);
    expect(result.delegates).toHaveLength(8);
    expect(result.hqUsers.map((u) => u.role).sort()).toEqual(['analyst', 'campaign_admin', 'coordinator']);

    for (const roomId of result.roomIds) {
      const voters = await withTenant(db, result.tenantId, (tx) =>
        tx
          .select({ id: schema.voterRecords.id })
          .from(schema.voterRecords)
          .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
          .where(eq(schema.familyRecords.roomId, roomId)),
      );
      expect(voters.length).toBeGreaterThan(0); // every room actually got voters resolved into it
    }
  });

  it('is deterministic: the same seed produces the same voter names', async () => {
    const a = await runSeed(db, { seed: 99, mohafazatCount: 1, qadasPerMohafazat: 1, centersPerQada: 1, roomsPerCenter: 1, familiesPerRoom: 2 });
    const b = await runSeed(db, { seed: 99, mohafazatCount: 1, qadasPerMohafazat: 1, centersPerQada: 1, roomsPerCenter: 1, familiesPerRoom: 2 });

    const namesFor = async (tenantId: string, roomId: string) =>
      withTenant(db, tenantId, (tx) =>
        tx
          .select({ name: schema.voterRecords.name })
          .from(schema.voterRecords)
          .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
          .where(eq(schema.familyRecords.roomId, roomId)),
      );

    const namesA = (await namesFor(a.tenantId, a.roomIds[0])).map((n) => n.name).sort();
    const namesB = (await namesFor(b.tenantId, b.roomIds[0])).map((n) => n.name).sort();
    expect(namesA).toEqual(namesB);
  });
});

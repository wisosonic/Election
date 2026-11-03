import { randomUUID } from 'crypto';
import { createDb, withTenant, schema, Db } from '../src';

/**
 * Proves the tenant-isolation RLS policy actually works, not just that the app
 * happens to filter by tenant_id in queries. FORCE ROW LEVEL SECURITY in
 * sql/001_schema.sql is what makes this meaningful -- without it, our own DB
 * role (the table owner) would bypass RLS entirely and this test would pass
 * for the wrong reason.
 */
describe('row-level security (tenant isolation)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenantA: string;
  let tenantB: string;
  let roomA: string;
  let roomB: string;

  beforeAll(async () => {
    ({ db, close } = await createDb());
    tenantA = randomUUID();
    tenantB = randomUUID();
    await db.insert(schema.tenants).values([
      { id: tenantA, name: 'Campaign A' },
      { id: tenantB, name: 'Campaign B' },
    ]);

    roomA = randomUUID();
    roomB = randomUUID();

    for (const [tenantId, roomId, label] of [
      [tenantA, roomA, 'A-Room'],
      [tenantB, roomB, 'B-Room'],
    ] as const) {
      await withTenant(db, tenantId, async (tx) => {
        const electionId = randomUUID();
        const mohafazatId = randomUUID();
        const qadaId = randomUUID();
        const centerId = randomUUID();
        await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15' });
        await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: 'M' });
        await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: 'Q' });
        await tx.insert(schema.votingCenters).values({ id: centerId, tenantId, qadaId, name: 'Center' });
        await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label });
      });
    }
  });

  afterAll(async () => {
    await close();
  });

  it('a session scoped to tenant A can see only tenant A rooms', async () => {
    const rows = await withTenant(db, tenantA, (tx) => tx.select().from(schema.rooms));
    expect(rows.map((r) => r.label)).toEqual(['A-Room']);
  });

  it('a session scoped to tenant B can see only tenant B rooms', async () => {
    const rows = await withTenant(db, tenantB, (tx) => tx.select().from(schema.rooms));
    expect(rows.map((r) => r.label)).toEqual(['B-Room']);
  });

  it('tenant A cannot write a row tagged as tenant B (WITH CHECK enforcement)', async () => {
    await expect(
      withTenant(db, tenantA, (tx) =>
        tx.insert(schema.rooms).values({
          id: randomUUID(),
          tenantId: tenantB, // mismatched on purpose
          votingCenterId: randomUUID(),
          label: 'Smuggled Room',
        }),
      ),
    ).rejects.toThrow();
  });

  it('a session with no tenant set sees nothing', async () => {
    // No withTenant wrapper -> app.tenant_id is unset -> current_setting(..., true) is NULL,
    // and tenant_id = NULL is never true, so the policy hides every row.
    const rows = await db.select().from(schema.rooms);
    expect(rows).toHaveLength(0);
  });
});

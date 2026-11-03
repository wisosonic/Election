import { randomUUID } from 'crypto';
import { createDb, Db, schema } from '@election/db';
import { GeoService } from '../src/geo/geo.service';

describe('GeoService (list endpoints)', () => {
  let db: Db;
  let close: () => Promise<void>;
  let geo: GeoService;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    ({ db, close } = await createDb());
    geo = new GeoService(db);
    tenantA = randomUUID();
    tenantB = randomUUID();
    await db.insert(schema.tenants).values([
      { id: tenantA, name: 'Campaign A' },
      { id: tenantB, name: 'Campaign B' },
    ]);
  });

  afterAll(async () => {
    await close();
  });

  it('builds and lists the full hierarchy, filtered correctly by parent id at each level', async () => {
    const electionId = await geo.createElection(tenantA, 'Election A', '2026-05-15');
    const mohafazatId = await geo.createMohafazat(tenantA, electionId, 'Mount Lebanon');
    const otherMohafazatId = await geo.createMohafazat(tenantA, electionId, 'Beirut');
    const qadaId = await geo.createQada(tenantA, mohafazatId, 'Baabda');
    await geo.createQada(tenantA, otherMohafazatId, 'Beirut I'); // different parent -- must not leak into Baabda's list
    const centerId = await geo.createVotingCenter(tenantA, qadaId, 'Baabda School');
    const roomId = await geo.createRoom(tenantA, centerId, 'Room 1');

    expect((await geo.listElections(tenantA)).map((e) => e.id)).toEqual([electionId]);

    const mohafazats = await geo.listMohafazats(tenantA, electionId);
    expect(mohafazats.map((m) => m.id).sort()).toEqual([mohafazatId, otherMohafazatId].sort());

    const qadas = await geo.listQadas(tenantA, mohafazatId);
    expect(qadas.map((q) => q.id)).toEqual([qadaId]); // not Beirut I

    const centers = await geo.listVotingCenters(tenantA, qadaId);
    expect(centers.map((c) => c.id)).toEqual([centerId]);

    const rooms = await geo.listRoomsForCenter(tenantA, centerId);
    expect(rooms.map((r) => r.id)).toEqual([roomId]);

    expect((await geo.listAllRooms(tenantA)).map((r) => r.id)).toEqual([roomId]);
  });

  it("never returns another tenant's rows, even for the same parent-shaped query", async () => {
    // tenantB has no data at all -- every list should come back empty, not error.
    expect(await geo.listElections(tenantB)).toEqual([]);
    expect(await geo.listAllRooms(tenantB)).toEqual([]);
  });
});

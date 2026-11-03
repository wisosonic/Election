import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';

@Injectable()
export class GeoService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createElection(tenantId: string, name: string | null, electionDate: string): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) => tx.insert(schema.elections).values({ id, tenantId, name, electionDate }));
    return id;
  }

  async createMohafazat(tenantId: string, electionId: string, name: string): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) => tx.insert(schema.mohafazats).values({ id, tenantId, electionId, name }));
    return id;
  }

  async createQada(tenantId: string, mohafazatId: string, name: string): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) => tx.insert(schema.qadas).values({ id, tenantId, mohafazatId, name }));
    return id;
  }

  async createVotingCenter(
    tenantId: string,
    qadaId: string,
    name: string,
    address?: string,
    geoLat?: number,
    geoLng?: number,
  ): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(schema.votingCenters).values({ id, tenantId, qadaId, name, address, geoLat, geoLng }),
    );
    return id;
  }

  async createRoom(tenantId: string, votingCenterId: string, label: string): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) => tx.insert(schema.rooms).values({ id, tenantId, votingCenterId, label }));
    return id;
  }

  // ---- Reads: for the dashboard's cascading admin forms and live rooms overview ----

  listElections(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.elections));
  }

  listMohafazats(tenantId: string, electionId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.mohafazats).where(eq(schema.mohafazats.electionId, electionId)));
  }

  listQadas(tenantId: string, mohafazatId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.qadas).where(eq(schema.qadas.mohafazatId, mohafazatId)));
  }

  listVotingCenters(tenantId: string, qadaId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.votingCenters).where(eq(schema.votingCenters.qadaId, qadaId)));
  }

  listRoomsForCenter(tenantId: string, votingCenterId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.rooms).where(eq(schema.rooms.votingCenterId, votingCenterId)));
  }

  /** All rooms in the tenant -- the live ops overview (§5.2), not scoped to one center. */
  listAllRooms(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.rooms));
  }
}

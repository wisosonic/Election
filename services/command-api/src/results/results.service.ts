import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';

/** Read-only: these tables are written by mqtt-ingestion (delegate submissions
 * flowing through the broker/queue), never directly via this HTTP API. */
@Injectable()
export class ResultsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  turnoutForRoom(tenantId: string, roomId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.select().from(schema.turnoutEntries).where(eq(schema.turnoutEntries.roomId, roomId)),
    );
  }

  talliesForRoom(tenantId: string, roomId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.tallyEntries).where(eq(schema.tallyEntries.roomId, roomId)));
  }

  irregularitiesForRoom(tenantId: string, roomId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.select().from(schema.irregularities).where(eq(schema.irregularities.roomId, roomId)));
  }
}

import { randomUUID } from 'crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AccessTokenClaims } from '@election/auth';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';

export interface RangeImport {
  roomId: string;
  start: number;
  end: number;
}

export interface FamilyImport {
  registryNumber: number;
  members: { name: string; disambiguation?: Record<string, unknown> }[];
}

@Injectable()
export class VotersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Bulk import: persists each room's registry-number range(s), then resolves
   * every family (and its members) to a concrete room by range membership at
   * import time -- §5.5: "no runtime range math is needed to serve a room's list." */
  async importRegistry(tenantId: string, ranges: RangeImport[], families: FamilyImport[]): Promise<{ imported: number }> {
    await withTenant(this.db, tenantId, async (tx) => {
      for (const r of ranges) {
        await tx.insert(schema.roomRegistryRanges).values({
          id: randomUUID(),
          tenantId,
          roomId: r.roomId,
          registryRangeStart: r.start,
          registryRangeEnd: r.end,
        });
      }

      for (const f of families) {
        const match = ranges.find((r) => f.registryNumber >= r.start && f.registryNumber <= r.end);
        const familyId = randomUUID();
        await tx.insert(schema.familyRecords).values({
          id: familyId,
          tenantId,
          registryNumber: f.registryNumber,
          roomId: match?.roomId ?? null,
        });
        for (const m of f.members) {
          await tx.insert(schema.voterRecords).values({
            id: randomUUID(),
            tenantId,
            familyRecordId: familyId,
            name: m.name,
            disambiguation: m.disambiguation ?? null,
          });
        }
      }
    });
    return { imported: families.length };
  }

  /**
   * Returns the voter sublist for exactly one room -- §4.4: "on login, a
   * delegate receives -- and can only ever receive -- the sublist of voters
   * for their own assigned room." Enforced here at the authorization layer,
   * not left to the caller/UI: a delegate whose claims don't include roomId is
   * refused outright, and an analyst is refused regardless of room (§6.4
   * need-to-know -- raw PII isn't an analyst's to see even in aggregate form
   * elsewhere they get counts only). Every successful read is audit-logged.
   */
  async getRoomVoters(tenantId: string, requester: AccessTokenClaims, roomId: string) {
    if (requester.role === 'analyst') {
      throw new ForbiddenException('analysts see aggregate GOTV counts only, not individual voter records');
    }
    if (requester.role === 'delegate' && !(requester.roomIds ?? []).includes(roomId)) {
      throw new ForbiddenException('not assigned to this room');
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const voters = await tx
        .select({ id: schema.voterRecords.id, name: schema.voterRecords.name, disambiguation: schema.voterRecords.disambiguation })
        .from(schema.voterRecords)
        .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
        .where(eq(schema.familyRecords.roomId, roomId));

      await tx.insert(schema.auditLogs).values({
        id: randomUUID(),
        tenantId,
        actorId: requester.sub,
        action: 'voter_list.read',
        entityRef: `room:${roomId}`,
        hash: randomUUID(), // placeholder chain -- see AuditService for the real hash-chaining logic
      });

      return voters;
    });
  }

  /** Aggregate-only view: safe for `analyst` (§6.2/§6.4) -- no names, just counts. */
  async gotvAggregateForRoom(tenantId: string, roomId: string): Promise<{ total: number; votedCount: number; notYetVoted: number }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const voters = await tx
        .select({ id: schema.voterRecords.id })
        .from(schema.voterRecords)
        .innerJoin(schema.familyRecords, eq(schema.familyRecords.id, schema.voterRecords.familyRecordId))
        .where(eq(schema.familyRecords.roomId, roomId));

      const checkins = await tx
        .select({ voterRecordId: schema.voterCheckins.voterRecordId })
        .from(schema.voterCheckins)
        .where(and(eq(schema.voterCheckins.roomId, roomId), eq(schema.voterCheckins.reverted, false)));

      const votedIds = new Set(checkins.map((c) => c.voterRecordId));
      const total = voters.length;
      const votedCount = voters.filter((v) => votedIds.has(v.id)).length;
      return { total, votedCount, notYetVoted: total - votedCount };
    });
  }
}

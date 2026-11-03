import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq, and, isNull } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';

@Injectable()
export class DelegatesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async invite(tenantId: string, phone: string): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(schema.users).values({ id, tenantId, role: 'delegate', phone, authMethod: 'otp' }),
    );
    return id;
  }

  async assignToRoom(tenantId: string, delegateId: string, roomId: string, assignmentRole = 'primary'): Promise<string> {
    const id = randomUUID();
    await withTenant(this.db, tenantId, (tx) =>
      tx.insert(schema.delegateAssignments).values({ id, tenantId, delegateId, roomId, assignmentRole }),
    );
    return id;
  }

  async unassign(tenantId: string, assignmentId: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.update(schema.delegateAssignments).set({ unassignedAt: new Date() }).where(eq(schema.delegateAssignments.id, assignmentId)),
    );
  }

  async rosterForRoom(tenantId: string, roomId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          delegateId: schema.users.id,
          phone: schema.users.phone,
          connected: schema.deviceCredentials.connected,
          lastSeenAt: schema.deviceCredentials.lastSeenAt,
        })
        .from(schema.delegateAssignments)
        .innerJoin(schema.users, eq(schema.users.id, schema.delegateAssignments.delegateId))
        .leftJoin(schema.deviceCredentials, eq(schema.deviceCredentials.delegateId, schema.users.id))
        .where(and(eq(schema.delegateAssignments.roomId, roomId), isNull(schema.delegateAssignments.unassignedAt))),
    );
  }
}

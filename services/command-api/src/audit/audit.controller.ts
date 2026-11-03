import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';
import { JwtAuthGuard } from '../common/auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { AuthedRequest } from '../common/types';

@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('campaign_admin')
export class AuditController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return withTenant(this.db, req.user!.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.occurredAt)),
    );
  }
}

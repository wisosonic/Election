import {
  Body,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Param,
  Post,
  createParamDecorator,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Db, schema, withTenant } from '@election/db';
import { DB } from '../db.provider';

interface RevokeBody {
  tenantId: string;
}

const InternalSecretHeader = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest();
  return req.headers['x-internal-secret'];
});

/** Called by command-api when HQ marks a device lost/compromised (§4.4/§6.1).
 * Protected by a shared internal secret rather than a user-facing auth
 * scheme, since this is service-to-service, not delegate/HQ-facing. */
@Controller('internal/devices')
export class DevicesController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post(':id/revoke')
  async revoke(
    @Param('id') id: string,
    @Body() body: RevokeBody,
    @InternalSecretHeader() secret?: string,
  ): Promise<{ ok: true }> {
    if (process.env.INTERNAL_SHARED_SECRET && secret !== process.env.INTERNAL_SHARED_SECRET) {
      throw new ForbiddenException('invalid internal secret');
    }
    await withTenant(this.db, body.tenantId, (tx) =>
      tx
        .update(schema.deviceCredentials)
        .set({ revokedAt: new Date(), connected: false })
        .where(eq(schema.deviceCredentials.id, id)),
    );
    return { ok: true };
  }
}

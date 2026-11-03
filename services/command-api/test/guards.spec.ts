import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { generateSigningKeys, JwtVerifier, signAccessToken } from '@election/auth';
import { JwtAuthGuard } from '../src/common/auth.guard';
import { RolesGuard } from '../src/common/roles.guard';

function mockContext(headers: Record<string, string>): { ctx: ExecutionContext; req: { headers: Record<string, string>; user?: unknown } } {
  const req: { headers: Record<string, string>; user?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('JwtAuthGuard', () => {
  it('rejects a request with no Authorization header', async () => {
    const keys = await generateSigningKeys();
    const guard = new JwtAuthGuard(new JwtVerifier({ jwks: { keys: [keys.publicJwk] } }));
    const { ctx } = mockContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by an unrelated key', async () => {
    const keysA = await generateSigningKeys();
    const keysB = await generateSigningKeys();
    const token = await signAccessToken({ sub: 'u1', tenantId: 't1', role: 'delegate' }, keysA.privateKey, keysA.kid);
    const guard = new JwtAuthGuard(new JwtVerifier({ jwks: { keys: [keysB.publicJwk] } }));
    const { ctx } = mockContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token and attaches claims to the request', async () => {
    const keys = await generateSigningKeys();
    const token = await signAccessToken({ sub: 'u1', tenantId: 't1', role: 'campaign_admin' }, keys.privateKey, keys.kid);
    const guard = new JwtAuthGuard(new JwtVerifier({ jwks: { keys: [keys.publicJwk] } }));
    const { ctx, req } = mockContext({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.user as { tenantId: string }).tenantId).toBe('t1');
  });
});

describe('RolesGuard', () => {
  function contextWithUser(role: string, requiredRoles?: string[]): ExecutionContext {
    const req = { user: { role } };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
  }

  it('allows access when no @Roles metadata is present', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithUser('delegate'))).toBe(true);
  });

  it("denies access when the user's role isn't in the required list", () => {
    const reflector = { getAllAndOverride: () => ['campaign_admin'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(contextWithUser('analyst'))).toThrow(ForbiddenException);
  });

  it("allows access when the user's role is in the required list", () => {
    const reflector = { getAllAndOverride: () => ['campaign_admin', 'coordinator'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithUser('coordinator'))).toBe(true);
  });
});

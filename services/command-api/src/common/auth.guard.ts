import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtVerifier } from '@election/auth';
import { JWT_VERIFIER } from './jwt-verifier.provider';
import { AuthedRequest } from './types';

/**
 * Verifies the bearer token against identity-service's JWKS and attaches the
 * decoded claims as req.user. Every downstream handler reads tenantId/role
 * from req.user, never from the request body -- a client cannot claim to be
 * a different tenant or role than what its token actually says (§6.1/§6.2).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JWT_VERIFIER) private readonly verifier: JwtVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      req.user = await this.verifier.verify(token.slice('Bearer '.length));
    } catch {
      throw new UnauthorizedException('invalid or expired token');
    }
    return true;
  }
}

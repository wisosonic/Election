import { Provider } from '@nestjs/common';
import { JwtVerifier } from '@election/auth';

export const JWT_VERIFIER = Symbol('JWT_VERIFIER');

/** Real deployment: fetches identity-service's live JWKS by URL (cached by
 * `jose` internally) -- §6.1, no synchronous per-request call to
 * identity-service, just periodic JWKS refresh. Tests override this provider
 * with a JwtVerifier built from a static in-memory JWKS instead. */
export const jwtVerifierProvider: Provider = {
  provide: JWT_VERIFIER,
  useFactory: (): JwtVerifier => {
    const url = process.env.IDENTITY_JWKS_URL ?? 'http://localhost:3001/.well-known/jwks.json';
    return new JwtVerifier({ jwksUrl: url });
  },
};

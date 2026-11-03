import { AccessTokenClaims } from '@election/auth';

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AccessTokenClaims;
}

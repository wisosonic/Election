import { Provider } from '@nestjs/common';
import { generateSigningKeys, SigningKeys } from '@election/auth';

export const SIGNING_KEYS = Symbol('SIGNING_KEYS');

/** Generated once per process at startup. Losing these on restart invalidates
 * outstanding tokens -- acceptable for this phase; a real deployment would
 * persist/rotate keys via Secrets Manager (see docs/DEPLOYMENT.md). */
export const signingKeysProvider: Provider = {
  provide: SIGNING_KEYS,
  useFactory: async (): Promise<SigningKeys> => generateSigningKeys(),
};

import { Controller, Get, Inject } from '@nestjs/common';
import { SigningKeys } from '@election/auth';
import { SIGNING_KEYS } from '../keys.provider';

@Controller('.well-known')
export class JwksController {
  constructor(@Inject(SIGNING_KEYS) private readonly keys: SigningKeys) {}

  @Get('jwks.json')
  getJwks(): { keys: unknown[] } {
    return { keys: [this.keys.publicJwk] };
  }
}

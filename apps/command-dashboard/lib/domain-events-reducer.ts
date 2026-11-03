import type { DomainEvent } from '@election/shared-types';

/** Pure state-update function -- newest first, capped so the feed doesn't
 * grow unbounded over a long election day. Kept separate from the socket
 * hook so it's testable with no network/socket involved at all. */
export function addEvent(state: DomainEvent[], event: DomainEvent, max = 200): DomainEvent[] {
  return [event, ...state].slice(0, max);
}

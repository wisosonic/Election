import type { DomainEvent } from '@election/shared-types';
import { Badge, Tone } from './ui/Badge';

interface EventFeedProps {
  events: DomainEvent[];
}

const KIND_TONE: Record<DomainEvent['kind'], Tone> = {
  turnout: 'brand',
  tally: 'brand',
  irregularity: 'danger',
  'voter-checkin': 'success',
  presence: 'neutral',
  broadcast: 'warning',
  'messages/out': 'neutral',
};

/** Renders the live event feed -- newest first, already ordered by
 * lib/domain-events-reducer.ts. `aria-live="polite"` so screen-reader users
 * are told about new events arriving, the same as sighted users see them
 * appear. */
export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No events yet.</p>;
  }
  return (
    <ul aria-live="polite" aria-label="Live event feed" className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200">
      {events.map((event, i) => (
        <li key={`${event.occurredAt}-${i}`} className="flex items-center justify-between gap-3 bg-white px-4 py-3">
          <Badge tone={KIND_TONE[event.kind] ?? 'neutral'}>{event.kind}</Badge>
          <span className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleTimeString()}</span>
        </li>
      ))}
    </ul>
  );
}

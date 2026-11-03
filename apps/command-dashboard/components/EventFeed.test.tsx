import { render, screen } from '@testing-library/react';
import { EventFeed } from './EventFeed';
import type { DomainEvent } from '@election/shared-types';

describe('EventFeed', () => {
  it('shows a placeholder when there are no events', () => {
    render(<EventFeed events={[]} />);
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });

  it('renders each event kind', () => {
    const events: DomainEvent[] = [
      { tenantId: 't1', kind: 'turnout', payload: {}, occurredAt: new Date().toISOString() },
      { tenantId: 't1', kind: 'irregularity', payload: {}, occurredAt: new Date().toISOString() },
    ];
    render(<EventFeed events={events} />);
    expect(screen.getByText('turnout')).toBeInTheDocument();
    expect(screen.getByText('irregularity')).toBeInTheDocument();
  });
});

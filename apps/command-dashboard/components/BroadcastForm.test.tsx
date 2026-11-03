import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BroadcastForm } from './BroadcastForm';
import * as apiClient from '../lib/api-client';

jest.mock('../lib/api-client');
const mockedApi = apiClient as jest.Mocked<typeof apiClient>;

describe('BroadcastForm', () => {
  afterEach(() => jest.resetAllMocks());

  it('sends a room-scoped broadcast with the given token', async () => {
    mockedApi.broadcastMessage.mockResolvedValue({ id: 'msg-1' });
    const user = userEvent.setup();

    render(<BroadcastForm token="tok-abc" />);
    await user.type(screen.getByLabelText('Room ID'), 'room-1');
    await user.type(screen.getByLabelText('Message'), 'Polls open in 10 minutes');
    await user.click(screen.getByRole('button', { name: 'Send broadcast' }));

    await waitFor(() =>
      expect(mockedApi.broadcastMessage).toHaveBeenCalledWith('tok-abc', { roomId: 'room-1' }, 'Polls open in 10 minutes'),
    );
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
  });

  it('sends a qada-scoped broadcast when that option is selected', async () => {
    mockedApi.broadcastMessage.mockResolvedValue({ id: 'msg-2' });
    const user = userEvent.setup();

    render(<BroadcastForm token="tok-abc" />);
    await user.selectOptions(screen.getByLabelText('Send to'), 'qada');
    await user.type(screen.getByLabelText('Qada ID'), 'qada-1');
    await user.type(screen.getByLabelText('Message'), 'Reminder to all rooms');
    await user.click(screen.getByRole('button', { name: 'Send broadcast' }));

    await waitFor(() =>
      expect(mockedApi.broadcastMessage).toHaveBeenCalledWith('tok-abc', { qadaId: 'qada-1' }, 'Reminder to all rooms'),
    );
  });

  it('shows an error message when the send fails', async () => {
    mockedApi.broadcastMessage.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();

    render(<BroadcastForm token="tok-abc" />);
    await user.type(screen.getByLabelText('Room ID'), 'room-1');
    await user.type(screen.getByLabelText('Message'), 'test');
    await user.click(screen.getByRole('button', { name: 'Send broadcast' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to send.');
  });
});

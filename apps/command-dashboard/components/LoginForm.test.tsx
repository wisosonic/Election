import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
import * as apiClient from '../lib/api-client';

jest.mock('../lib/api-client');
const mockedApi = apiClient as jest.Mocked<typeof apiClient>;

describe('LoginForm', () => {
  afterEach(() => jest.resetAllMocks());

  it('logs in with tenant/email/password, then TOTP, and calls onLoggedIn with the access token', async () => {
    mockedApi.hqLogin.mockResolvedValue({ pendingId: 'pending-1' });
    mockedApi.hqVerifyTotp.mockResolvedValue({ accessToken: 'access-token-xyz', refreshToken: 'refresh-token' });
    const onLoggedIn = jest.fn();
    const user = userEvent.setup();

    render(<LoginForm onLoggedIn={onLoggedIn} />);

    await user.type(screen.getByLabelText('Campaign ID'), 'tenant-1');
    await user.type(screen.getByLabelText('Email'), 'admin@campaign.example');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(mockedApi.hqLogin).toHaveBeenCalledWith('tenant-1', 'admin@campaign.example', 'hunter2'));
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith('access-token-xyz'));
    expect(mockedApi.hqVerifyTotp).toHaveBeenCalledWith('pending-1', '123456');
  });

  it('shows an error message when the password step fails', async () => {
    mockedApi.hqLogin.mockRejectedValue(new Error('invalid or expired token'));
    const user = userEvent.setup();

    render(<LoginForm onLoggedIn={jest.fn()} />);
    await user.type(screen.getByLabelText('Campaign ID'), 'tenant-1');
    await user.type(screen.getByLabelText('Email'), 'admin@campaign.example');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or expired token');
  });
});

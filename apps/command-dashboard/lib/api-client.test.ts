import { hqLogin, broadcastMessage, ApiError } from './api-client';

describe('api-client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('hqLogin posts tenantId/email/password and returns the parsed pendingId', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pendingId: 'pending-123' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await hqLogin('tenant-1', 'a@b.com', 'secret');

    expect(result).toEqual({ pendingId: 'pending-123' });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/hq\/login$/);
    expect(JSON.parse(init.body)).toEqual({ tenantId: 'tenant-1', email: 'a@b.com', password: 'secret' });
  });

  it('broadcastMessage attaches the Authorization header and correct scope body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'msg-1' }) });
    global.fetch = mockFetch as unknown as typeof fetch;

    await broadcastMessage('tok-abc', { roomId: 'room-1' }, 'hello');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/messages\/broadcast$/);
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    expect(JSON.parse(init.body)).toEqual({ roomId: 'room-1', body: 'hello' });
  });

  it('throws an ApiError with the response status on a non-OK response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid or expired token',
    }) as unknown as typeof fetch;

    await expect(hqLogin('t', 'a@b.com', 'wrong')).rejects.toBeInstanceOf(ApiError);
    await expect(hqLogin('t', 'a@b.com', 'wrong')).rejects.toMatchObject({ status: 401 });
  });
});

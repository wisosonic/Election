/**
 * Typed fetch wrapper for identity-service and command-api. Every
 * command-api call attaches the bearer token as the Authorization header --
 * the server (not this client) is the actual authority on tenant/role scoping
 * (see services/command-api/src/common/auth.guard.ts).
 */

const IDENTITY_URL = process.env.NEXT_PUBLIC_IDENTITY_URL ?? 'http://localhost:3001';
const COMMAND_API_URL = process.env.NEXT_PUBLIC_COMMAND_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(body || res.statusText, res.status);
  }
  return (await res.json()) as T;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

// ---- identity-service: HQ auth ----

export function hqLogin(tenantId: string, email: string, password: string): Promise<{ pendingId: string }> {
  return request(`${IDENTITY_URL}/auth/hq/login`, {
    method: 'POST',
    body: JSON.stringify({ tenantId, email, password }),
  });
}

export function hqVerifyTotp(pendingId: string, code: string): Promise<{ accessToken: string; refreshToken: string }> {
  return request(`${IDENTITY_URL}/auth/hq/verify-totp`, {
    method: 'POST',
    body: JSON.stringify({ pendingId, code }),
  });
}

// ---- command-api: geo hierarchy (admin screens) ----

export interface GeoRow {
  id: string;
  name?: string;
  label?: string;
}

export function listElections(token: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/elections`, { headers: authHeaders(token) });
}

export function createElection(token: string, name: string, electionDate: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/geo/elections`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ name, electionDate }) });
}

export function listMohafazats(token: string, electionId: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/elections/${electionId}/mohafazats`, { headers: authHeaders(token) });
}

export function createMohafazat(token: string, electionId: string, name: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/geo/mohafazats`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ electionId, name }) });
}

export function listQadas(token: string, mohafazatId: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/mohafazats/${mohafazatId}/qadas`, { headers: authHeaders(token) });
}

export function createQada(token: string, mohafazatId: string, name: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/geo/qadas`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ mohafazatId, name }) });
}

export function listVotingCenters(token: string, qadaId: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/qadas/${qadaId}/voting-centers`, { headers: authHeaders(token) });
}

export function createVotingCenter(token: string, qadaId: string, name: string, address?: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/geo/voting-centers`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ qadaId, name, address }),
  });
}

export function listRoomsForCenter(token: string, votingCenterId: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/voting-centers/${votingCenterId}/rooms`, { headers: authHeaders(token) });
}

export function createRoom(token: string, votingCenterId: string, label: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/geo/rooms`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ votingCenterId, label }) });
}

export function listAllRooms(token: string): Promise<GeoRow[]> {
  return request(`${COMMAND_API_URL}/geo/rooms`, { headers: authHeaders(token) });
}

// ---- command-api: delegates ----

export function inviteDelegate(token: string, phone: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/delegates/invite`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ phone }) });
}

export function assignDelegate(token: string, delegateId: string, roomId: string): Promise<{ id: string }> {
  return request(`${COMMAND_API_URL}/delegates/assign`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ delegateId, roomId }),
  });
}

// ---- command-api: voter registry import ----

export interface VoterImportBody {
  ranges: { roomId: string; start: number; end: number }[];
  families: { registryNumber: number; members: { name: string; disambiguation?: Record<string, unknown> }[] }[];
}

export function importVoters(token: string, body: VoterImportBody): Promise<{ imported: number }> {
  return request(`${COMMAND_API_URL}/voters/import`, { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body) });
}

// ---- command-api: broadcast messaging ----

export function broadcastMessage(token: string, scope: { roomId: string } | { qadaId: string }, body: string): Promise<{ id: string }> {
  const scopeBody = 'roomId' in scope ? { roomId: scope.roomId } : { qadaId: scope.qadaId };
  return request(`${COMMAND_API_URL}/messages/broadcast`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ ...scopeBody, body }),
  });
}

# Election Campaign Management Platform

A multi-tenant campaign management platform for Lebanese parliamentary candidates. Delegates inside voting rooms track voter turnout, count votes, report irregularities, and communicate with campaign HQ; HQ gets real-time insights and control over the whole operation.

Full design docs: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (architecture, data model, security) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (AWS deployment plan). [CLAUDE.md](CLAUDE.md) is the living record of every design decision and why it was made — read it before changing anything architectural.

## Overview

The system is two independently deployable modules:

- **Delegate Module** — an Android app (React Native) delegates use inside voting rooms: offline-first voter check-in, turnout counts, vote tallies, irregularity reports, and messaging with HQ. Distributed as a private sideloaded APK, not via Google Play. **Not yet implemented in this repo** — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4 for its full design.
- **Central Server Module** — everything else, and what's actually built here: an MQTT broker + ingestion pipeline, a REST admin API, a real-time WebSocket relay, and an HQ dashboard. AWS-hosted in production; runs entirely on your machine for development (details below).

### Real-world terminology

Lebanese voting-day structure drives the data model: **Mohafazat** (governorate) → **Qada** → **Voting Center** (a public school) → **Room** (قلم — the actual polling-station unit, with its own ballot box and tally). A voter's room isn't assigned directly; each room owns a range of national family-registry numbers, and a family record (multiple voters) resolves to a room by that range. See [CLAUDE.md](CLAUDE.md) for the full glossary.

## Architecture

```
Delegate device (Android, not yet built)
        │ MQTT (device-authenticated, topic-ACL'd)
        ▼
┌─────────────────────────── Central Server Module ───────────────────────────┐
│  mqtt-ingestion  → durable queue → Postgres (RLS, tenant-isolated)           │
│        │                                    ▲                               │
│        │ domain events (pub/sub)            │ REST (JWT + RBAC)             │
│        ▼                                    │                               │
│  realtime-service  ──── WebSocket ────  command-dashboard  ── REST ── command-api
│                                                                    ── REST ── identity-service (auth)
└───────────────────────────────────────────────────────────────────────────────┘
```

| Layer | Path | What it does |
|---|---|---|
| `packages/db` | Drizzle schema + hand-written SQL migration for every entity, with Postgres Row-Level Security enforcing tenant isolation. `createDb()` gives you PGlite (in-process, no setup) or a real Postgres via `DATABASE_URL`. |
| `packages/shared-types` | MQTT topic scheme, zod payload contracts, the `DomainEvent`/pub-sub channel constant — the versioned contract every service codes against. |
| `packages/mqtt-broker` | `MqttBrokerPort` + an embedded Aedes adapter (per-device auth, topic ACLs, connect/disconnect hooks). |
| `packages/queue` | `QueuePort` + an in-process adapter (retry, dead-letter) + an SQS adapter stub for AWS. |
| `packages/pubsub` | `PubSubPort` + an in-process adapter + a Redis adapter stub — how `mqtt-ingestion`/`command-api` tell `realtime-service` about new events. |
| `packages/auth` | RS256 JWT signing + JWKS-based verification, shared by every service. |
| `services/identity-service` | Delegate phone+OTP login, HQ email+password+TOTP login, device credential issuance, `/.well-known/jwks.json`. |
| `services/command-api` | REST API: election/geo hierarchy, delegate invite/assignment, voter registry import + GOTV views, results reads, broadcast messaging, audit log, the seed CLI. |
| `services/mqtt-ingestion` | Runs the MQTT broker, enforces topic ACLs, validates payloads, persists to Postgres idempotently, tracks delegate presence, publishes domain events. |
| `services/realtime-service` | Socket.IO server: JWT-authenticated, one room per tenant, relays domain events live to HQ dashboards. |
| `apps/command-dashboard` | Next.js HQ dashboard: login, live event feed, election/geo/delegate/voter-registry admin screens, broadcast messaging. |

## Key design decisions

The full rationale for each of these lives in [CLAUDE.md](CLAUDE.md#key-design-decisions-and-why) — read it before working against the grain of any of them:

- Two modules only. The Delegate Module has no backend of its own; the Central Server Module is one release train internally composed of several independently-scaling services.
- MQTT (not HTTPS) for delegate ↔ server, backed by a durable queue, because delegate submissions spike sharply at poll-open/midday/poll-close.
- Postgres Row-Level Security for tenant isolation — enforced at the DB layer, not just in application code. (Note: RLS is bypassed by a Postgres superuser regardless of `FORCE ROW LEVEL SECURITY`; the app connects as a dedicated non-superuser `app_user` role — see `packages/db/sql/001_schema.sql`.)
- Append-only turnout/tally/audit records — election data must be defensible after the fact.
- Voter check-in is the most sensitive data category in the system: data-minimized, on-device-encrypted, read-audited, and restricted from the `analyst` role (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4.4/§6.4).
- Every port/adapter pair (`MqttBrokerPort`, `QueuePort`, `PubSubPort`) has a real, fully-tested local implementation and a cloud adapter stub (AWS IoT Core/SQS, Redis) that isn't exercised without real cloud credentials.

## Repository structure

```
election-platform/
├── packages/       db, shared-types, mqtt-broker, queue, pubsub, auth
├── services/       identity-service, command-api, mqtt-ingestion, realtime-service
├── apps/           command-dashboard
├── docs/           ARCHITECTURE.md, DEPLOYMENT.md
├── docker-compose.yml   real Postgres + Redis for local dev (needs Docker)
├── server-backend.sh    build + run/stop/status the four backend services
├── server-frontend.sh   build + run/stop/status the HQ dashboard
├── server-all.sh        both of the above together
└── CLAUDE.md        design-decision log — read this first
```

## Development setup

**Quickest path**, once dependencies are installed (see below): `./server-all.sh start` builds and runs everything — the four backend services and the HQ dashboard — in one command (`stop`/`status` work the same way). It's a thin wrapper around `server-backend.sh` and `server-frontend.sh` below; use those two directly if you only need one side running.

### Prerequisites

- Node.js 20+ (built and tested on Node 24) and npm.
- Docker, **optional** — everything below runs without it (PGlite stands in for Postgres, an embedded MQTT broker stands in for a real one). Docker is only needed for `docker-compose.yml`'s real Postgres/Redis, which you'd want for running multiple backend processes together against one shared database (see the caveat below).

### Install and build

```bash
npm install

# Build the shared packages first -- the services resolve them via their
# compiled dist/, so this has to happen before anything else builds or runs:
for p in auth db mqtt-broker pubsub queue shared-types; do
  npm run build --workspace=packages/$p
done
```

(This is also needed before `npm test` will pass for the services — their tests import the shared packages via their compiled `dist/`, same as at runtime. `server-backend.sh` rebuilds them itself every time it starts, so you don't need to repeat this once you're using it.)

### Run the tests

```bash
npm test          # every workspace: ~95 tests, no Docker required
npm run build      # full build, including the dashboard's `next build`
```

Tests run against PGlite (a real Postgres, compiled to WebAssembly, running in-process) and an embedded MQTT broker (Aedes) — no external services needed. This also means Row-Level Security, MQTT topic ACLs, and Socket.IO tenant isolation are exercised for real in CI, not mocked.

### Run the backend services

The easiest way — `server-backend.sh` builds the shared packages, builds and launches all four backend services as detached background processes, and (if Docker is available) brings up Postgres + Redis first so they actually share data instead of each getting its own empty in-process database:

```bash
./server-backend.sh start    # build + launch identity-service, command-api,
                              # mqtt-ingestion, realtime-service
./server-backend.sh status   # check what's running and on which port
./server-backend.sh stop     # stop everything it started
```

Logs go to `logs/<service>.log`; PID files (used by `status`/`stop`) go to `.pids/`. Without Docker, it still works — it just warns and falls back to each service's own isolated PGlite/in-process pub-sub (see the caveat below).

| Service | Default port | Directory |
|---|---|---|
| `identity-service` | 3001 | `services/identity-service` |
| `command-api` | 3000 | `services/command-api` |
| `mqtt-ingestion` | MQTT on 1883 (no HTTP) | `services/mqtt-ingestion` |
| `realtime-service` | 3002 | `services/realtime-service` |

<details>
<summary>Running a service manually instead (e.g. to iterate on just one)</summary>

```bash
cd services/identity-service && npm run build && npm start
cd services/command-api && npm run build && npm start
cd services/mqtt-ingestion && npm run build && npm start
cd services/realtime-service && npm run build && npm start
```

</details>

**Important — shared database across processes**: with no `DATABASE_URL` set, every service defaults to its own private, in-process PGlite instance. That's ideal for tests (fully isolated) but means running several services as separate processes with *no* `DATABASE_URL` gives each one an *empty, unshared* database — `command-api` won't see data `mqtt-ingestion` wrote, etc. `server-backend.sh` handles this for you when Docker is present; to do it yourself:

```bash
docker compose up -d postgres redis   # from the repo root
```

Then set `DATABASE_URL=postgres://election:election@localhost:5432/election` for `identity-service`, `command-api`, and `mqtt-ingestion`, and `REDIS_URL=redis://localhost:6379` for `command-api`, `mqtt-ingestion`, and `realtime-service` (this is also what actually bridges `mqtt-ingestion`'s and `realtime-service`'s pub/sub across processes — without it they can't hear each other; see `CLAUDE.md`).

Other environment variables you may need (all read directly by `server-backend.sh` too, so exporting them before calling it works the same way):

| Variable | Used by | Default |
|---|---|---|
| `IDENTITY_PORT` / `COMMAND_API_PORT` / `REALTIME_PORT` | `server-backend.sh` (sets each service's `PORT`) | 3001 / 3000 / 3002 |
| `DATABASE_URL` | `identity-service`, `command-api`, `mqtt-ingestion` | none → in-process PGlite |
| `REDIS_URL` | `command-api`, `mqtt-ingestion`, `realtime-service` | none → in-process pub/sub (same-process only) |
| `IDENTITY_JWKS_URL` | `command-api`, `mqtt-ingestion`, `realtime-service` | `http://localhost:3001/.well-known/jwks.json` |
| `MQTT_PORT` | `mqtt-ingestion` (the broker's own port) | `1883` |
| `MQTT_BROKER_URL` | `command-api` (to publish broadcasts) | `mqtt://localhost:1883` |
| `MQTT_SERVICE_USERNAME` / `MQTT_SERVICE_PASSWORD` | `command-api` ↔ `mqtt-ingestion` (the broadcast-publisher's own broker credential) | `command-api` / *(empty)* |
| `INTERNAL_SHARED_SECRET` | `identity-service`'s device-revoke endpoint | none → unrestricted (set this in any shared environment) |

### Seed dummy data

Never run against a real voter registry or in `NODE_ENV=production` — the generator refuses (`services/command-api/seed/guard.ts`):

```bash
cd services/command-api
npx ts-node seed/generate.ts       # or: npm run seed (from the repo root)
```

This builds a full synthetic hierarchy (mohafazat → qada → voting center → room → registry ranges → family records → voters) plus a tenant, delegates, and HQ users, and prints the seeded HQ logins (email/password/TOTP secret) to the console. Point it at the same `DATABASE_URL` your running services use, or it'll seed a throwaway in-memory database that vanishes when the command exits.

### Run the frontend

```bash
./server-frontend.sh start    # Next.js dev server (hot reload) on :3005
./server-frontend.sh status
./server-frontend.sh stop

./server-frontend.sh start --prod   # production-style: `next build` then `next start`
```

It defaults to port **3005**, not Next's usual 3000, since `command-api` already uses 3000 — override with `PORT=<port> ./server-frontend.sh start`. It talks to the backends via `NEXT_PUBLIC_IDENTITY_URL`, `NEXT_PUBLIC_COMMAND_API_URL`, and `NEXT_PUBLIC_REALTIME_URL` (all default to `localhost:3001`/`3000`/`3002`, i.e. `server-backend.sh`'s defaults) — export them first if you changed those ports. Logs go to `logs/command-dashboard.log`.

<details>
<summary>Running it manually instead</summary>

```bash
cd apps/command-dashboard
npm run dev -- -p 3005
```

</details>

## Staging & production

`dev` and `staging` always run on generated seed data, never real voter PII (see `CLAUDE.md`'s design-decision table). Deployment architecture, AWS service mapping, and the CI/CD pipeline are documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What's not built yet

Stated plainly rather than glossed over:

- The **Delegate Module** (the Android app) — design is complete ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §4), no code yet.
- Real AWS wiring (IoT Core, SQS, Secrets Manager, FCM) — only local adapters and stubs exist; nothing has been run against a real AWS account.
- Qada-level scoping for the `coordinator` role's realtime feed — currently scoped by tenant only (see `CLAUDE.md`).
- Real browser/E2E testing of the dashboard — verified via `next build` (typechecks, compiles, statically generates every route), component tests, and confirming the live dev server actually serves `/login` correctly (`curl` returning 200 with real compiled output), but no graphical browser or click-through interaction testing (no browser-automation tooling available in this environment).

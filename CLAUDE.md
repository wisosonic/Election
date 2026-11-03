# CLAUDE.md

Guidance for Claude Code (and any developer) working in this repository.

## Project Overview

A multi-tenant campaign management platform for Lebanese parliamentary candidates. Two independently deployable modules:

- **Delegate Module** (`apps/delegate-mobile`) — offline-capable Android app (React Native), client-only with no backend of its own, used by delegates physically present in a voting room to check in voters, log turnout, submit vote tallies, report irregularities, and message HQ. Distributed as a privately sideloaded, signed APK (not via Google Play).
- **Central Server Module** (`apps/command-dashboard` + `services/mqtt-ingestion` + `services/command-api` + `services/realtime-service` + `services/identity-service`) — AWS-hosted: MQTT broker + ingestion queue/workers, dashboard, analytics, and election/user administration for campaign HQ. One deployable unit internally composed of several independently-scaling services.

Full architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Deployment plan: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). This file summarizes the decisions that should shape how code in this repo is written, and captures the user stories/requirements the design is built from.

## Real-world terminology (use these terms, not generic ones)

Lebanese voting-day structure, confirmed with stakeholder — **Mohafazat** (governorate) → **Qada** → **Voting Center** → **Room** (قلم):
- A **Voting Center** is a public school building (the addressable/geo level).
- A **Room** (قلم) is the actual polling-station unit inside a center — its own ballot box, tally, and delegate(s). Anywhere earlier drafts said "station," it now means **Room**.
- **Multiple delegates from the same campaign in one Room is normal**, not an edge case.
- Voters aren't assigned to rooms directly: each **Room** is assigned a range (or ranges) of national **family-registry numbers** ("رقم القيد"). A registry number identifies a **family record**, which has multiple individual voter members. "A room's voter list" = every voter whose family record's registry number falls in one of that room's ranges.

See `docs/ARCHITECTURE.md` §1.1 and §7 for the full data model this implies (`VotingCenter`, `Room`, `RoomRegistryRange`, `FamilyRecord`, `VoterRecord`).

## Key Design Decisions (and why)

| Decision | Why |
|---|---|
| Two modules: Delegate Module is a client-only mobile app (no backend of its own); Central Server Module holds all backend concerns (MQTT broker, ingestion queue, APIs, dashboard, DB) | Keeps the system genuinely down to two deployable units — an earlier draft gave the Delegate Module its own backend API service, which was simplified away per stakeholder direction |
| Delegate ↔ server communication over MQTT (device connectivity) backed by a durable queue inside the Central Server Module | Delegate submissions spike sharply at poll-open/midday/poll-close across many rooms at once; MQTT suits constrained/intermittent device connections (persistent connection, QoS 1 delivery, native presence via Last Will), and the queue behind the broker absorbs bursts so ingestion/DB writes don't need to scale as fast as connection intake |
| Delegate Module is a native Android app (React Native), sideloaded as a signed APK rather than distributed via Google Play; Central Server Module is an AWS-hosted web app | Stakeholder decision. Native app gives more reliable background sync (WorkManager) and push (FCM) than a browser PWA would; sideloading avoids Play Store review turnaround before an election. iOS explicitly out of scope, matching the confirmed low-end-Android-majority delegate device profile |
| Multi-tenant with Postgres Row-Level Security | Multiple candidates/parties share the platform; data isolation must be enforced at the DB layer, not just in application code |
| Offline-first delegate client (local write + background sync) | Voting-room connectivity is unreliable; delegates must never be blocked from recording data |
| Append-only turnout/tally/audit records (no in-place edits) | Election data must be defensible after the fact; every change needs a full history, not just a current value |
| Phone + OTP auth for delegates, email + MFA for HQ | Delegates are numerous and provisioned close to election day (low-friction, phone-native); HQ accounts hold broader access and warrant stronger auth |
| Shared Identity Service verified via cached JWKS (not a live call per request) | Keeps the two modules from having a hard runtime dependency on a third service |
| Voter check-in (per-voter, not just aggregate turnout) is in scope, confirmed legally permitted | Enables real GOTV outreach (who from our supporter base hasn't voted yet) rather than just an aggregate count; treated as the most sensitive data category in the system — see `docs/ARCHITECTURE.md` §4.4 and §6.4 for its distinct handling (data minimization, on-device encryption + app PIN lock, read-auditing, need-to-know within HQ) |
| Voter list distributed via bulk authenticated HTTPS pull, not MQTT | The list is large and changes rarely — a poor fit for broker messaging designed around small, frequent event publishes |
| Voter-to-room assignment resolved via family-registry ranges, denormalized onto each family record at import time | Matches how Lebanon actually organizes voter lists (range of registry numbers per room); resolving at import means the delegate app just asks for "my room's list" with no range math on-device |
| `dev`/`staging` run on a generated seed dataset (full synthetic hierarchy: mohafazat → qada → voting center → room → registry ranges → family records → voters, plus tenant/election/delegates/HQ users), never real voter PII | The real registry doesn't exist yet — a deterministic, re-runnable generator exercises the actual data shape (ranges, per-room resolution) end-to-end instead of leaving the feature untestable or hand-writing unrealistic fixtures. Lives at `services/command-api/seed/`; never run against `prod` |
| Domain events (turnout/tally/irregularity/voter-checkin/presence/broadcast) fan out from `mqtt-ingestion`/`command-api` to `realtime-service` via a `PubSubPort` (`packages/pubsub`) — a `LocalPubSubAdapter` for tests/same-process wiring, a `RedisPubSubAdapter` for real cross-process delivery | Mirrors the `MqttBrokerPort`/`QueuePort` seam pattern from the rest of the backend. **Known limitation**: `LocalPubSubAdapter` only bridges a publisher and subscriber that share one process — it does NOT connect separately-run `mqtt-ingestion` and `realtime-service` processes. Real multi-process delivery needs Redis (already in `docker-compose.yml`), not available in the environment this was built in |
| `realtime-service` uses Socket.IO (not raw `ws`), one room per tenant (`tenant:{tenantId}`) | Rooms map directly onto "broadcast to everyone in this tenant"; client-side reconnection handling comes for free |
| Realtime feed and dashboard views are scoped by **tenant only** for all HQ roles — `coordinator` currently sees the whole tenant's events, not narrowed to an assigned qada | HQ access tokens carry no qada-level scoping today (only delegates get `roomIds`/`qadaId`). Narrowing `coordinator` to their assigned qada(s) would need a `coordinator_qada_assignments` table + a token claim — a stated follow-up, not done |

Do not casually violate these without discussing the tradeoff — they exist to satisfy specific constraints (independent deployability, offline reliability, tenant isolation, election-data defensibility), not arbitrary preference.

## User Stories & Requirements

**Status: confirmed with stakeholder** (see "Confirmed Requirements Decisions" at the end of this section for the specific answers this draft was updated against).

### Personas

- **Room Delegate** — physically present in one room (قلم) for the day; primary data-entry role; assume a non-technical user on a low-end Android phone with possibly poor signal. Multiple Room Delegates from our own campaign in the same room is normal.
- **District Coordinator** (HQ) — oversees a subset of qadas (drillable to voting center/room); front-line responder to irregularities and delegate questions.
- **Campaign Manager / Admin** (HQ) — full control within their tenant; sets up the election, mohafazat/qada/voting-center/room hierarchy, user accounts, and imports the voter registry.
- **Analyst** (HQ) — read-only access to *aggregate* turnout/tally/GOTV analytics; explicitly does not see individual voter names/PII.

### Delegate — Voter Check-in & GOTV
- As a Room Delegate, I want to search my room's voter list and mark a voter as "voted" when they arrive, so HQ knows in real time who from our supporter base still hasn't voted.
- As a Room Delegate, I want to undo a check-in mistake, so a mis-tap doesn't leave a wrong record with no way to correct it.
- As a Room Delegate, I want my room's voter list already on my phone before polls open (not fetched during the day), so a bad connection never blocks me from checking someone in.
- As a Campaign Manager, I want to import the official voter registry (family records, their members, and each room's registry-number ranges) ahead of election day, so delegates have their room's list ready and HQ can see who hasn't voted yet.
- As a Campaign Manager, I want a live, filterable view (down to room level) of registered supporters who haven't voted yet, so our GOTV team can prioritize calls and rides during the day.
- As a Campaign Manager, I want individual voter names/details restricted to roles that need them for GOTV (not visible to a read-only analyst), and every view of that data logged, so this, the most sensitive data in the system, gets tighter handling than everything else.

### Delegate — Turnout Tracking
- As a Room Delegate, I want to log the voter turnout count at set checkpoints, so HQ has an accurate real-time picture of participation. *(Where a digitized voter list exists, this count is derived automatically from check-ins rather than entered separately.)*
- As a Campaign Manager, I want to configure the turnout-checkpoint schedule per election (there's no legally mandated cadence), so I can adapt it to what this campaign actually needs.
- As a Room Delegate, I want to submit a turnout count with no internet connection, so a bad signal in my room never blocks my work.
- As a Room Delegate, I want clear confirmation once a submission has synced, so I know HQ actually received it and don't need to re-check.

### Delegate — Vote Counting
- As a Room Delegate, I want to enter the final tally per candidate/list at close of polls, so HQ gets official results immediately.
- As a Room Delegate, I want another delegate from our own campaign in the same room (when one is present — this is normal, not exceptional) to be able to co-confirm my tally submission, so entry errors are caught, without blocking submission in rooms where we only have one delegate.
- As a Room Delegate, I want to cross-reference my submitted tally against the officially posted results for my room, so a discrepancy with the official count is flagged immediately rather than discovered later. *(Since other parties' delegates aren't part of this system, the official posted tally — not a same-campaign witness — is the real independent check in single-delegate rooms.)*
- As a Room Delegate, I want to attach a photo of the official tally sheet to my submission, so there's evidence backing the numbers (confirmed legally permitted).

### Delegate — Irregularity Reporting
- As a Room Delegate, I want to report an irregularity with a category, severity, and description, so HQ can respond appropriately.
- As a Room Delegate, I want to flag a report as urgent, so it reaches a coordinator immediately instead of sitting in a general queue.
- As a Room Delegate, I want to attach photos/video to a report, so HQ can assess the situation without being physically present.

### Delegate — Communication
- As a Room Delegate, I want to message my district coordinator directly, so I can raise questions or concerns in real time.
- As a Room Delegate, I want to receive broadcast alerts from HQ, so I stay informed of instructions or changes.
- As a Room Delegate, I want to acknowledge a critical directive, so HQ knows I've seen it.

### HQ — Live Operations
- As a Campaign Manager, I want a live map of all voting centers and rooms, grouped by mohafazat and qada, color-coded by status, so I can immediately spot rooms needing attention at whatever level I'm looking.
- As a District Coordinator, I want to see only the rooms in my assigned qada(s), so I'm not overwhelmed by data outside my responsibility.
- As a Campaign Manager, I want real-time turnout and tally analytics, so I can make informed decisions during election day itself, not after.
- As a Campaign Manager, I want to see which delegates haven't reported within an expected window, so I can follow up before a silent room becomes a bigger problem.

### HQ — Irregularity Triage
- As a District Coordinator, I want an incoming queue of reports sorted by severity, so I address the most urgent issues first.
- As a District Coordinator, I want to assign a report to myself or a teammate, so responsibility for follow-up is unambiguous.
- As a Campaign Manager, I want a full audit trail of how each irregularity was handled, so we can defend our response if it's challenged later.

### HQ — Communication & Administration
- As a Campaign Manager, I want to broadcast a message to all delegates, or to a specific qada/voting center/room, so I can quickly disseminate instructions.
- As a District Coordinator, I want to see whether a delegate has acknowledged a critical directive, so I know it actually landed.
- As a Campaign Manager, I want to define the election and its mohafazat/qada/voting-center/room hierarchy ahead of time, so the system is ready the moment polls open.
- As a Campaign Manager, I want to invite delegates by phone number and assign them to rooms, so access is scoped correctly from day one.
- As a Campaign Manager, I want to manage HQ staff roles (coordinator, analyst), so access matches responsibility.

### Cross-cutting / Non-functional
- As any user, I want the interface in Arabic (my working language), so it's usable without translation friction.
- As a Campaign Manager, I want assurance that another campaign on the same platform cannot see our data, so competitively sensitive information stays confidential.
- As a Campaign Manager, I want the system to stay responsive even when thousands of rooms report simultaneously at poll-close, so we don't lose visibility at the most critical moment.
- As a Room Delegate, I want a simple login (phone + OTP) that I don't have to repeat constantly, so friction doesn't slow me down on election day.

## Confirmed Requirements Decisions

Answered directly by the stakeholder; these supersede the earlier draft assumptions and are reflected in the user stories above.

| Question | Answer | Impact |
|---|---|---|
| Turnout-checkpoint cadence | Campaign-defined, no legal mandate | HQ configures the checkpoint schedule per election rather than the system hard-coding one |
| Legal permissibility of photographing the official tally sheet | Permitted | Photo evidence stays in the tally-submission workflow with no caveat |
| Delegate staffing per room | Multiple delegates from our own campaign in one room is normal, not exceptional (other parties' delegates in the same room are separate entities outside this system) | Co-confirmation of a tally is optional (used whenever a second delegate happens to be present); the officially posted tally is the primary independent cross-check regardless |
| Administrative hierarchy | Mohafazat (governorate) → Qada → Voting Center (school) → Room (قلم) | Full four-level hierarchy in the data model (§7 of `docs/ARCHITECTURE.md`) — voting centers hold the address/geo, rooms are the actual polling/tally/MQTT-scoping unit |
| Voter-to-room assignment | Each room is assigned a range of national family-registry numbers ("رقم القيد"); a registry number is a family record containing multiple voters | Modeled as `RoomRegistryRange` + `FamilyRecord` + `VoterRecord`; range membership is resolved once at import time, not computed on-device |
| Delegate device profile | Low-end Android majority | Confirms the offline-first, low-spec-optimized native app approach — no design change needed |
| Existing paper-based workflow to mirror | None — greenfield | The digital workflow can be designed for what's optimal rather than constrained to replicate a legacy paper process |
| Voter list source & scoping | The candidate campaign supplies the actual voter registry later (placeholder/synthetic data used until then, same pattern as the FCM credential); each delegate must see only their own room's sublist, never another room's | `dev`/`staging` build and test against synthetic voter data; the per-room restriction is enforced at the API authorization layer, not just hidden in the UI |

## Still Open

- **Voter-level data retention**: how long check-in/voter-list data should be retained after the election, and whether it should be purged/anonymized afterward, is a policy call for the campaign/legal counsel — not yet decided. See `docs/ARCHITECTURE.md` §4.4.
- **Lost/stolen delegate device response**: HQ can revoke a device's credentials immediately, but can't remotely wipe an already-cached local voter list — the campaign should have its own documented incident response for this scenario (outside this system's scope to enforce).

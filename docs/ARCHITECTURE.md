# Election Campaign Management System — Architecture & Design

## 1. Summary

A multi-tenant platform serving multiple Lebanese parliamentary candidates/parties. Each tenant (campaign) gets isolated delegates, voting-room data, and a Central Command dashboard. The system is split into **two independently deployable modules**:

| Module | Runs on | Used by |
|---|---|---|
| **Delegate Module** | Delegate's phone — Android native mobile app (React Native), client-only — no backend service of its own | Delegates physically present in voting rooms |
| **Central Server Module** | AWS-hosted web application — MQTT broker, ingestion queue, APIs, analytics, dashboard, database | Campaign HQ staff, coordinators, candidates |

The Delegate Module never talks to anything except the Central Server Module's MQTT broker over a secured MQTT connection. The Central Server Module is a single deployable unit internally composed of several services (broker, ingestion workers, APIs, dashboard) that can scale independently, but ships and releases as one module. This is a deliberate simplification from an earlier draft that gave the Delegate Module its own backend API service — folding all server-side concerns into one Central Server Module keeps the system genuinely down to two modules, at the cost of the Delegate Module having no server logic of its own (acceptable, since all of its "backend" needs are now covered by MQTT connectivity to the Central Server).

Assumptions confirmed with stakeholder:
- Delegate devices normally have cellular data; when offline, submissions queue locally and are published once connectivity is restored.
- Platform is multi-tenant (many candidates/parties, isolated data).
- Target deployment is a public cloud (reference design uses AWS; largely portable to Azure/GCP — see Deployment Plan).
- Tech stack chosen for fit, not mandated by the client.
- **Real Lebanese voting-day geography/organization** (see §1.1 below) — replaces an earlier, looser "station" model.
- Turnout-checkpoint cadence is campaign-defined (no legal mandate); photographing the official tally sheet is legally permitted.
- Delegate ↔ server communication is **MQTT** (device connectivity) backed by a **durable queue** inside the Central Server Module (buffering/decoupling ingestion from processing).
- Delegate Module is an **Android-only native mobile app built with React Native**, distributed as a **sideloaded APK** (not via Google Play) so rollout/updates aren't subject to app-store review turnaround right before an election.
- Delegate ↔ Central Server voter-list handling is scoped per-room (see §1.1), sourced from data the candidate campaign supplies later; the actual voter registry doesn't exist yet, so `dev`/`staging` use synthetic placeholder data.

### 1.1 Real-world geography and organization (confirmed with stakeholder)

Lebanese voting-day structure, and the terms used throughout this document:

- **Mohafazat** (governorate) → **Qada** → **Voting Center** → **Room** (قلم, transliterated "qalam").
- A **Voting Center** is a physical public school building. It's the level that has a street address/geo-coordinates.
- Each Voting Center is divided into one or more **Rooms** (قلم) — this is the actual polling-station unit: its own ballot box, its own tally, its own delegate(s). Everything earlier drafts called "station" now means **Room**.
- **One or more delegates from the same campaign can be legitimately present in the same Room** — this is normal, not an exceptional "double-staffed" case — so the data model always allows multiple `DelegateAssignment`s per room.
- **Each Room is assigned a range (or ranges) of national family-registry numbers ("رقم القيد")**. A registry number identifies a *family record*, and a family record contains *multiple individual voters* (its members). A voter's assigned room is therefore derived from which room's registry-number range their family record falls into — not assigned to individual voters directly.

This changes the data model (§7) and the delegate's "assigned unit" for MQTT scoping, tallying, and voter check-in from the earlier generic "station" to the real **Room**, with **Voting Center** as the addressable level above it.

---

## 2. High-Level Architecture

```mermaid
flowchart TB
    subgraph Delegate["DELEGATE MODULE (independently deployable — client only)"]
        APP["Delegate App\n(React Native, Android\noffline-capable, local queue)"]
        MQTTC["Native MQTT client\n(direct TCP over TLS)"]
        FCM["FCM push\n(app-closed alerts)"]
        APP --> MQTTC
        FCM -.wakes.-> APP
    end

    subgraph Central["CENTRAL SERVER MODULE (independently deployable)"]
        direction TB
        Broker[["MQTT Broker\n(per-device auth + topic ACLs)"]]
        Queue[["Durable Queue\nSQS/Kafka"]]
        Workers["Ingestion Workers\n(validate, dedupe, persist)"]
        CAPI["Command API\n(admin, elections, users)"]
        RT["Realtime/Analytics Service"]
        IdP["Identity & Tenant Service\n(AuthN/AuthZ)"]
        CDB[("Postgres\nmulti-tenant, RLS")]
        Dash["HQ Dashboard (web)"]

        Broker --> Queue --> Workers --> CDB
        Workers --> RT
        Dash <-->|HTTPS + WSS| CAPI
        Dash <--> RT
        CAPI --> CDB
        CAPI -->|publish broadcasts/directives| Broker
        CAPI -->|critical alert, app closed| FCMSvc["FCM (push relay)"]
        Dash -.auth.-> IdP
        CAPI -.auth.-> IdP
        Broker -.per-device cert/token check.-> IdP
    end

    MQTTC ===>|publish: turnout, tally,\nirregularity, message, voter-checkin\nQoS 1, periodic flush| Broker
    Broker ===>|subscribe: broadcasts,\ndirectives \(retained\)| MQTTC
    FCMSvc -.push notification.-> FCM
```

**Why MQTT + a durable queue instead of plain HTTPS:** MQTT is designed for exactly this environment — many constrained, intermittently-connected clients. It gives us, essentially for free:
- **Lightweight persistent connections** with automatic reconnect/keep-alive, well suited to delegates' cellular conditions.
- **QoS 1 delivery** (at-least-once) so a publish isn't silently lost if the connection drops mid-send.
- **Native presence detection** via MQTT's Last Will and Testament — the broker can publish a "delegate went dark" event the instant a connection drops uncleanly, without a custom heartbeat protocol.
- **Retained messages** for the downlink — a delegate reconnecting after a dead zone immediately receives the latest HQ broadcast for their topic without HQ needing to resend it.
- **Fine-grained security boundary**: the broker authenticates each device individually (certificate or token) and enforces **topic-level ACLs** so a delegate's client can only publish/subscribe on its own room's topics — a stronger per-device authorization model than a single shared bearer-token API, and it means delegate devices never reach anything past the broker.
- Being a **native Android app** (not a browser client) means the MQTT client connects directly over TCP/TLS to the broker — no WebSocket bridging needed — and can use Android's `WorkManager` to keep flushing the local queue on a schedule even while backgrounded. If Android kills the process entirely (memory pressure, long backgrounding), a low-priority **Firebase Cloud Messaging (FCM)** push is used as a wake-up/critical-alert channel for HQ broadcasts — MQTT handles the steady-state traffic, FCM is the fallback for the fully-stopped-process case that no persistent-connection protocol can cover on its own.

The **durable queue** behind the broker (e.g., broker rule → SQS, or a Kafka bridge) exists because poll-open/midday/poll-close produce sharp submission spikes across potentially thousands of rooms at once. The queue absorbs that burst so ingestion workers and the database write path don't need to scale as fast as the broker's connection/message-intake rate does.

**Delegates publish periodically, not on every keystroke**: the app writes locally first (§4.2) and flushes its pending queue over MQTT on an interval (short — seconds, not minutes) plus immediately for high-severity events (e.g., an urgent irregularity), so the "near real-time" requirement isn't traded away for battery/bandwidth efficiency on routine updates.

---

## 3. Repository Structure

```
election-platform/
├── apps/
│   ├── delegate-mobile/           # React Native (Android) app — the entire Delegate Module; no server component
│   └── command-dashboard/        # HQ dashboard — part of the Central Server Module
├── services/                     # All part of the Central Server Module
│   ├── mqtt-ingestion/            # Broker config/rules, queue consumers — validate, dedupe, persist
│   ├── command-api/               # Admin, election setup, user management
│   │   └── seed/                  # dev/staging synthetic data generator (§5.6) — never run against prod
│   ├── realtime-service/          # Dashboard subscriptions, live aggregation
│   └── identity-service/          # AuthN/AuthZ, tenant management, device credential issuance
├── packages/
│   ├── shared-types/              # Topic/payload & DTO contracts shared across services (versioned)
│   ├── ui-kit/                    # Shared design system components (dashboard; mobile app has its own native components)
│   └── config/                    # Lint/tsconfig/test config shared across packages
├── infra/
│   ├── delegate-module/           # APK build/signing pipeline + private distribution hosting — no runtime infra
│   └── central-server/            # Broker, queue, DB, APIs, dashboard — one IaC stack, one deploy pipeline
└── docs/
```

`apps/delegate-mobile` has no corresponding backend to redeploy in lockstep — releasing a new signed APK is the entirety of "deploying the Delegate Module." The Central Server Module is one release train internally, even though `mqtt-ingestion`, `command-api`, `realtime-service`, and `identity-service` scale as separate processes/containers under the hood. `packages/shared-types` is the only coupling between the two modules — a versioned contract (topic names, payload shapes), not a runtime dependency.

---

## 4. Delegate Module — Design

### 4.1 Core functions
- **Voter check-in against the room's voter sublist**: delegate marks each voter as "voted" as they arrive, searching/filtering a pre-loaded copy of the voters assigned to their specific room (see §4.4). This is the primary GOTV data source for HQ — see §5.2.
- **Voter turnout tracking**: where a digitized voter list exists for a room, the turnout count is *derived* from the running total of check-ins rather than entered twice; a manual count entry remains available as a fallback for rooms where a digitized list isn't available, at a checkpoint cadence configured per election by HQ (no legally mandated schedule).
- **Vote counting**: end-of-day tally entry per candidate/list, submitted per room (each room has its own ballot box and count). **Co-confirmation is optional, not required**: since one or more of our own campaign's delegates may be present in the same room, a second delegate present can co-confirm a tally, but it isn't guaranteed at every room. The primary independent check regardless of staffing level is comparing our submitted tally against the officially posted results, with any discrepancy flagged to HQ automatically.
- **Irregularity reporting**: structured incident form (category, severity, free text, optional photo/video attachment) with a "flash" priority path that publishes immediately rather than waiting for the periodic flush.
- **Communication with HQ**: two-way messaging — delegate-initiated questions/alerts published like any other event, and HQ-initiated broadcasts/directives delivered via a subscribed, retained MQTT topic (acknowledgement-tracked).

### 4.2 Offline-first design
- Built as a **React Native Android app**, distributed as a signed, sideloaded APK (see Deployment Plan) rather than through Google Play — avoids store-review turnaround right before an election and lets HQ push urgent fixes directly.
- **Local-first writes**: every action (turnout entry, tally, irregularity, message, voter check-in) is written immediately to on-device storage (SQLite, via a library such as WatermelonDB or op-sqlite) and marked `pending_publish`. The UI never blocks on network or on the MQTT connection.
- **Native MQTT publish**: a native MQTT client (direct TCP/TLS to the broker, no WebSocket bridging needed) stays connected while the app is running and flushes the pending local queue on a short interval (configurable, e.g., every 15–30s) at QoS 1, plus immediately for flagged-urgent records (irregularities marked high severity).
- **Background execution**: an Android `WorkManager` periodic task keeps the flush running even when the app is backgrounded (not just foregrounded), which is more reliable than what a browser-based PWA could offer. If Android fully kills the process (memory pressure, long idle), a low-priority FCM push wakes the app or, for time-critical HQ broadcasts, delivers the alert directly through the notification system as a fallback.
- **Reconnect handling**: if the MQTT connection drops, records simply stay `pending_publish` in the local queue exactly as if never sent; the client reconnects with exponential backoff and resumes flushing — no different in effect from full offline, just shorter-lived.
- **Idempotency**: every locally created record carries a client-generated UUID, so QoS-1 redelivery or a reconnect-triggered resend never creates a duplicate server-side (ingestion workers upsert on `client_uuid`).
- **Append-only, not edited-in-place**: tallies and turnout counts are timestamped, versioned entries — the "current value" is derived server-side from the latest accepted entry per room, so the device never needs to resolve merge conflicts locally.
- **Sync status visibility**: delegates see a clear per-item indicator (queued / published / acknowledged) so they trust the system even through spotty connectivity.
- **Downlink**: the device subscribes to its tenant/qada/room-scoped broadcast topic; retained messages mean a delegate coming back online after a dead zone gets the latest HQ directive immediately, without HQ having to resend it. FCM push is the fallback for when the app process isn't alive at all to hold that subscription.
- **In-app update check**: since there's no app store to auto-update installs, the app checks a version endpoint on the Central Server Module at launch and prompts the delegate to download/install a newer signed APK when one is available.

### 4.3 Topic scheme (illustrative)
```
tenants/{tenant_id}/rooms/{room_id}/turnout        (publish, delegate → server)
tenants/{tenant_id}/rooms/{room_id}/tally           (publish, delegate → server)
tenants/{tenant_id}/rooms/{room_id}/irregularity    (publish, delegate → server)
tenants/{tenant_id}/rooms/{room_id}/voter-checkin   (publish, delegate → server)
tenants/{tenant_id}/rooms/{room_id}/messages/out    (publish, delegate → server)
tenants/{tenant_id}/rooms/{room_id}/broadcast       (subscribe, server → delegate, retained)
tenants/{tenant_id}/qadas/{qada_id}/broadcast       (subscribe, server → delegate, retained)
```
Broker ACLs bind each authenticated device to only the topics for its own assigned room(s) and qada — enforced at the broker, not just the application layer. The voter list itself (§4.4) is not delivered over MQTT — it's too large and too infrequent to change to justify broker messaging; it's pulled via a one-off authenticated HTTPS request instead.

### 4.4 Voter List & Check-in

Confirmed with stakeholder: delegates digitizing and syncing per-voter check-in data is legally permitted, and the intended use is real-time check-in tracking (not just a static reference copy) so HQ can run get-out-the-vote (GOTV) outreach during the day. This is the most sensitive data category in the system — it warrants its own handling, distinct from the aggregate turnout/tally data designed earlier.

- **Family-registry structure**: a voter's list membership is not assigned directly — each **Room** is assigned one or more ranges of national family-registry numbers ("رقم القيد"); a **family record** (identified by that registry number) contains multiple individual voters (its members). "The room's voter sublist" means every voter belonging to a family record whose registry number falls inside one of that room's assigned ranges (§7 formalizes this as `FamilyRecord` + `RoomRegistryRange`).
- **Provisioning (bulk, not MQTT)**: HQ imports the official registry (family records, their member voters, and each room's registry-number ranges) into the Central Server Module ahead of election day (§5.5). Range-to-family resolution happens at import time, not on the device, so the app never needs to do range arithmetic — it just requests "my room's voters" and gets a flat, pre-resolved list. Each delegate device pulls its assigned room's list via a one-time authenticated HTTPS request — ideally during the pre-election "dry run" when the device has good connectivity — and caches it locally. A version/checksum check on each app launch re-pulls only if the list changed.
- **Real data arrives later**: the actual voter registry (family records, members, and room ranges) is supplied by the candidate campaign closer to election day — the same deferred-credential pattern as the per-tenant Firebase key (§6.5). `dev`/`staging` build and test this feature against synthetic placeholder data until the real list is provided; nothing about the design depends on having it now.
- **Per-room scoping is mandatory, not just a UI filter**: on login, a delegate receives — and can only ever receive — the sublist of voters for their own assigned room, never another room's, even one in the same voting center. This is enforced at the authorization layer on the HTTPS pull itself (the endpoint only returns records for rooms the authenticated delegate is assigned to), not merely by the app choosing what to display — so a modified or compromised client still can't pull another room's list.
- **Data minimization (recommendation — confirm before building)**: even though the official registry may include fields like sect/confession, full family-register details, etc., only what's needed to identify a voter and support GOTV should be digitized and synced — voter name, the family registry number, and enough disambiguating detail (e.g., father's/mother's name) to tell same-named voters apart. Fields not needed for check-in or GOTV shouldn't be typed into the system just because they're on the paper list, to keep the blast radius of any breach as small as possible.
- **Check-in flow**: delegate searches/filters the local list, taps to mark a voter "voted" (timestamped), with an undo option. Check-ins publish over MQTT like any other record — batched on the same periodic flush as turnout/tally (§4.2), each carrying a client UUID for idempotency; undos are new append-only entries (a correction record), never a deletion, preserving the audit trail.
- **On-device protection**: the cached voter list is meaningfully more sensitive than anything else stored on the device, so it's held in encrypted local storage (e.g., SQLCipher-backed SQLite, not a plaintext DB), and the app requires its own PIN/biometric unlock in addition to the initial phone-OTP account login — so a device that's lost or borrowed while merely "signed in" still doesn't expose the list.
- **Device-lost response**: HQ can revoke a delegate's MQTT/device credential immediately (§6.1); this stops the device from syncing further, though it can't remotely erase an already-cached local copy — a reported-lost device should be treated as a data-exposure incident, not just an access-revocation one, and campaigns should have a plan for that (out of this system's scope to enforce, but worth the client's team having a documented response step).
- **Retention (needs a decision, not assumed)**: how long voter-level check-in data (as opposed to aggregate counts) should be retained after the election, and whether it should be purged/anonymized afterward, is a policy call for the campaign/legal counsel — flagged here rather than defaulted.

### 4.5 UX principles
- Optimized for low-end Android phones and poor screen conditions (large tap targets, high contrast, minimal typing — prefer counters/steppers and pre-set categories over free text).
- Single-purpose screens per task (voter check-in, turnout, tally, report, message) reachable in ≤2 taps from home.
- Works in Arabic (primary) with LTR/RTL-aware layout; French/English as secondary locales.
- Pre-election "dry run" mode so delegates can rehearse the exact flow before election day — also the natural point to walk delegates through installing the sideloaded APK (enabling "install from unknown sources," first launch, OTP login) so it isn't a surprise on election morning.

---

## 5. Central Server Module — Design

### 5.1 Ingestion (broker → queue → workers)
- The **MQTT broker** (e.g., AWS IoT Core, or a self-hosted cluster such as EMQX/HiveMQ) terminates all delegate device connections, authenticates each one individually, and enforces the topic ACLs described in §4.3.
- Incoming messages are routed (broker rule engine, or a bridge) into a **durable queue** (SQS, or Kafka) — this is what absorbs submission bursts at poll-open/midday/poll-close without requiring the database write path to scale at the same rate as connection/message intake.
- **Ingestion workers** consume the queue, validate payloads against the shared contract, dedupe on `client_uuid`, and persist append-only records to Postgres; they also feed the realtime-service for live dashboard updates.
- Dead-letter handling on the queue with alerting, so malformed or repeatedly-failing messages surface to operators rather than silently vanishing.

### 5.2 HQ-facing functions
- **Live operations map**: all voting centers/rooms for the tenant's election, color-coded by status (reporting normally / delayed / irregularity flagged / gone dark — the last driven directly by MQTT Last-Will events, not a polled heartbeat), drillable from mohafazat → qada → voting center → room.
- **Real-time analytics**: turnout curves (overall, by mohafazat/qada/voting center/room), tally aggregation as results come in, projected turnout vs. historical baselines.
- **Irregularity triage**: incoming incident queue, severity-sorted, assignable to a coordinator, with status tracking (new → acknowledged → resolved) and audit trail.
- **Delegate directory & messaging**: roster of delegates per room, presence/last-seen (from broker connection state), broadcast messaging (all delegates / by qada / by voting center / by room) published back onto the relevant MQTT topic, directive acknowledgement tracking.
- **Voter list & GOTV**: import the official voter registry (family records, members, and each room's registry-number ranges) ahead of election day (§5.5); live view of which registered supporters haven't voted yet, filterable down to room level, to organize phone-bank/ride-to-polls outreach during the day.
- **Election & user administration**: define elections and their mohafazat/qada/voting-center/room hierarchy; invite/manage HQ staff and delegates; assign roles; provision each delegate device's MQTT credentials; supply the tenant's own Firebase (FCM) project credentials for push notifications (see §6.5 and the Deployment Plan) — each campaign owns and pays for its own Firebase project rather than sharing one platform-wide project.

### 5.3 Real-time delivery to dashboards
- `realtime-service` consumes from the ingestion path (workers or queue directly) and fans out updates to connected dashboards over WebSocket (or a managed pub/sub like AWS AppSync / API Gateway WebSocket, to avoid operating a custom WS fleet at scale).
- Dashboard subscribes only to the tenant + election + qada(s)/room(s) the logged-in user has access to (server-side authorization on the subscription, not just the REST API).

### 5.4 Analytics approach
- Hot path: incoming events update pre-aggregated rollups (per room, per voting center, per qada, per mohafazat, per tenant) in near real-time (materialized in Postgres via triggers/CQRS read models, or a lightweight OLAP store such as ClickHouse if query volume grows beyond what Postgres rollups handle comfortably).
- Cold path: full event history retained (append-only) for audit, post-election reporting, and dispute resolution.

### 5.5 Voter list distribution (bulk HTTPS, not MQTT)
- HQ uploads the official voter registry through `command-api` ahead of election day — a bulk import (e.g., CSV from the official source) of family records, their member voters, and each room's assigned registry-number range(s). Import resolves each family record (and its members) to a concrete room based on range membership, storing that resolved assignment directly (§7) so no runtime range math is needed to serve a room's list.
- Delegate devices pull their assigned room's list via an authenticated HTTPS `GET` (not MQTT — the payload is comparatively large and changes rarely, so a request/response pull fits better than broker messaging), during pre-election onboarding/dry-run while on good connectivity.
- Any pre-election correction (e.g., a late update from the official source, or a range adjustment) increments a version/checksum so devices detect and re-pull only when needed, rather than every launch.

### 5.6 Dev/staging seed data (generated, not real)
Since the real voter registry doesn't exist yet (§4.4), `dev` and `staging` run against a **generated seed dataset** instead of leaving the feature untestable or hand-writing fixtures:
- A seed generator produces a full synthetic hierarchy end-to-end — mohafazat(s) → qadas → voting centers → rooms, each room given a plausible contiguous registry-number range, and family records + member voters populated within those ranges (synthetic Arabic names, realistic family sizes) — so the *shape* of the data (ranges, room resolution, family/voter relationships) is exercised exactly as it will be with the real registry, not a simplified stand-in.
- Deterministic (fixed random seed) and idempotent/re-runnable, so `dev` can be reset to a known state on demand and test runs are reproducible.
- Also seeds the surrounding synthetic context needed to exercise the whole system in `dev`/`staging`: a tenant/election, delegate accounts assigned to rooms, and HQ users — not voter data in isolation.
- Lives alongside `command-api` (the service that owns import/admin) as a seed script/CLI command, invoked in `dev` setup and in CI before integration tests — never run against `prod`.
- This is a stand-in for real data only — it does not change the per-room scoping or authorization rules from §4.4; a seeded delegate account still only ever gets its own seeded room's list.

---

## 6. Authentication & Authorization

### 6.1 Identity model
- **Multi-tenant**: every user (delegate or HQ staff) belongs to exactly one tenant (campaign). All data access is scoped by `tenant_id`; enforced at the database layer (row-level security in Postgres), not just in application code, so a bug in one query can't leak cross-tenant data.
- **Delegate authentication (login)**: phone-number based, since delegates are numerous, often non-technical, and provisioned close to election day.
  1. HQ pre-registers each delegate's phone number and assigned room(s).
  2. Delegate logs in with phone number + OTP (SMS) once, on a trusted device.
  3. On successful login, the Identity Service issues that device an **MQTT credential** — either a short-lived token used as the MQTT username/password, or a provisioned X.509 client certificate (e.g., an AWS IoT Core "thing" certificate) — scoped to exactly that delegate's assigned room(s)/qada.
  4. A new device requires re-verification via OTP before it receives its own MQTT credential; a lost/compromised device's credential can be revoked at the broker without affecting other delegates.
- **HQ staff authentication**: email + password with mandatory MFA (TOTP), since HQ accounts have broader access (aggregate results, broadcast, admin); used for the dashboard's HTTPS/WSS session, not MQTT.
- **Tokens**: short-lived JWT access tokens (5–15 min) + rotating refresh tokens for HQ/dashboard sessions, signed by the Identity Service, verified via cached JWKS. MQTT credentials are validated by the broker itself (via its built-in auth hook/Lambda authorizer, calling Identity Service only at connect time, not per message).

### 6.2 Authorization (RBAC)
| Role | Scope |
|---|---|
| `super_admin` (platform) | Cross-tenant platform operations (rare, heavily audited) |
| `campaign_admin` | Full control within their tenant |
| `coordinator` | Assigned qada(s) (drillable to voting center/room): view analytics, triage irregularities, message delegates |
| `analyst` | Read-only *aggregate* analytics within tenant — explicitly excludes raw voter-level PII (see §6.4) |
| `delegate` | Publish/subscribe only on their assigned room's/qada's MQTT topics; no visibility into other rooms' data |

### 6.3 Election-integrity-specific controls
- Every published record carries the delegate's identity (from its MQTT credential) and is stored with an immutable audit record (who, when, from which device, from which prior value) — critical for defensibility if results are challenged.
- Append-only audit log (hash-chained records) for all tally changes and admin actions.
- Rate limiting + anomaly detection on submission patterns (e.g., a room reporting implausible turnout jumps) to catch both technical bugs and attempted manipulation.

### 6.4 Voter data protection
- **Need-to-know within HQ**: individual voter names/PII are visible only to roles that genuinely need them for GOTV work (`campaign_admin`, `coordinator`); `analyst` sees aggregate not-yet-voted counts per room/qada, not the underlying names — least-privilege applies inside HQ too, not just between delegate and HQ.
- **Read auditing**: unlike most of this system (which audits writes), access to voter-level PII is logged on *read* as well — every dashboard view or export of a room's voter list records who viewed it and when, given how sensitive this data category is.
- **Encryption**: voter PII columns encrypted at rest server-side (in addition to Postgres RLS tenant isolation) and, on the delegate device, the entire cached list lives in encrypted local storage (§4.4) — not just relying on RLS/ACLs, given the consequences of a leak.
- **Export controls**: any bulk export of voter-level data (vs. aggregate reports) requires `campaign_admin` approval and is itself audit-logged — this is the one dataset in the system where even authorized-role access should leave an extra paper trail.

### 6.5 Per-tenant push (FCM) credentials
- Each tenant (campaign) owns and pays for its own Firebase project — pushes for tenant A never flow through tenant B's Firebase quota/billing, matching the multi-tenant isolation principle applied everywhere else in this design.
- The tenant's FCM server key is stored in Secrets Manager under a per-tenant path (e.g., `tenants/{tenant_id}/fcm-server-key`) and is only used by the Central Server Module when sending that tenant's app-closed/critical-alert pushes.
- Until a campaign supplies its real Firebase project, its environment runs against a placeholder/test project — sufficient for building and testing the push path end-to-end, but a real project must be in place before that tenant's election-day go-live, since MQTT alone (§4.2) can't reach a fully-stopped app process.

---

## 7. Data Model (core entities)

| Entity | Key fields | Notes |
|---|---|---|
| `Tenant` | id, candidate/party name, fcm_credential_ref | Root of isolation; `fcm_credential_ref` points to the tenant's own Firebase project credentials in Secrets Manager, not a shared platform-wide project |
| `Election` | id, tenant_id, date | A tenant may run multiple elections over time |
| `Mohafazat` | id, election_id, name | Governorate level; top of the geographic hierarchy |
| `Qada` | id, mohafazat_id, name | District level; a coordinator is typically scoped to one or more qadas |
| `VotingCenter` | id, qada_id, name, address, geo | The physical school; the addressable/geo level |
| `Room` (قلم) | id, voting_center_id, label | The actual polling-station unit — own ballot box, own tally, own delegate(s); also the MQTT topic-scoping unit |
| `RoomRegistryRange` | room_id, registry_range_start, registry_range_end | Defines which family-registry numbers ("رقم القيد") belong to a room; a room may have more than one range |
| `FamilyRecord` | id (= national registry number), room_id (resolved at import time from `RoomRegistryRange`) | One registry number per family; `room_id` is denormalized at import so no runtime range lookup is needed |
| `VoterRecord` | id, family_record_id, name, disambiguation_fields | A family record has multiple member voters; deliberately excludes non-essential fields (e.g., sect/confession) per the data-minimization recommendation in §4.4 |
| `DelegateAssignment` | delegate_id, room_id, role | Many-to-many, time-bounded; a room commonly has more than one same-campaign delegate assigned, not just as an edge case |
| `DeviceCredential` | delegate_id, device_id, credential_type (token/cert), issued_at, revoked_at | Tracks/enables revocation of each device's MQTT credential independently |
| `VoterCheckIn` | voter_record_id, room_id, checked_in_by, timestamp, client_uuid, reverted (bool) | Append-only; an undo is a new entry with `reverted=true`, never a deletion |
| `TurnoutEntry` | room_id, timestamp, count, submitted_by, client_uuid, publish_status | Append-only; derived from `VoterCheckIn` counts where a digitized list exists, otherwise entered manually |
| `TallyEntry` | room_id, candidate/list_id, count, submitted_by, co_confirmed_by (nullable), official_tally_photo_ref, client_uuid | Append-only; `co_confirmed_by` is set when a second delegate from our campaign present in the same room co-confirms — otherwise reconciliation relies on comparing against the officially posted tally |
| `Irregularity` | room_id, category, severity, description, media_refs, status, assigned_to | |
| `Message` | thread_id, from, to (user/role/broadcast), body, ack_status | |
| `AuditLog` | actor_id, action, entity_ref, prev_hash, hash, timestamp | Immutable, hash-chained |
| `User` | id, tenant_id, role, phone/email, auth_method | |

---

## 8. Scalability & Reliability

- **Load shape**: highly spiky — quiet most of the day, sharp bursts at poll-open, midday checkpoint, and poll-close/tally time, across potentially thousands of rooms nationally.
- **MQTT broker**: use a managed broker built for device-fleet scale (AWS IoT Core comfortably handles millions of concurrent connections) rather than operating a self-managed cluster, unless the deployment target rules out AWS-managed services.
- **Ingestion queue + workers**: the queue absorbs burst message intake so downstream workers/database writes don't need to scale as fast as the broker's connection/message rate; workers themselves are stateless and horizontally autoscaled.
- **Command API / realtime-service**: read-heavy, autoscaled independently from ingestion since their load profile differs (dashboard viewers are steadier than delegate submission bursts).
- **Database**: managed Postgres with read replicas for dashboard queries; write path kept lean (append-only inserts, aggregation via async workers/materialized views rather than heavy synchronous joins).
- **Caching**: Redis for session/token lookups, rate-limit counters, and hot rollup data (current turnout/tally per room).
- **Media**: irregularity photos/videos go directly to object storage (S3) via pre-signed upload URLs — never proxied through the API.
- **Backpressure**: if the queue backs up, the broker keeps accepting publishes (buffered at the broker/queue layer) and the Delegate Module keeps accepting local writes regardless; dashboards degrade gracefully (slightly stale) rather than the system failing.
- **Load testing**: mandatory pre-election rehearsal at simulated national scale (all rooms, synthetic delegate connections publishing at realistic intervals) before go-live.

---

## 9. Communication Tools (delegate ↔ HQ)

- **Structured channels** (preferred over free chat, for auditability): turnout submission, tally submission, irregularity report, voter check-in, room status — each its own MQTT topic.
- **Free-text messaging**: per-room topic for delegate → HQ messages, plus HQ broadcast to all/qada/voting center/room (retained MQTT messages) with required acknowledgement for critical directives.
- **Presence**: broker connection state + MQTT Last Will and Testament gives HQ an immediate, native "gone dark" signal per delegate, without a custom heartbeat/polling mechanism.
- **Escalation**: irregularity severity ≥ "high" publishes immediately (bypassing the periodic flush interval) and triggers push notification + SMS fallback to the assigned coordinator, not just an in-dashboard flag.

---

## 10. Tech Stack (proposed)

| Layer | Choice | Rationale |
|---|---|---|
| Delegate Mobile App | React Native + TypeScript (Android target only), WatermelonDB/SQLite, native MQTT client (direct TCP/TLS), Firebase Cloud Messaging | Reuses the team's React/TypeScript skillset from the dashboard; native background execution and push are materially more reliable than a browser PWA for this use case |
| Command Dashboard | React + TypeScript (Next.js) | SSR for fast first load, shares TypeScript tooling/conventions with the mobile app (not UI components — different platform) |
| MQTT broker | AWS IoT Core (managed) — or EMQX/HiveMQ if self-hosted/multi-cloud | Purpose-built for large device fleets: per-device auth, topic ACLs, scales to millions of connections without operating a broker cluster |
| Ingestion queue | AWS SQS (via IoT Core Rule Engine), or Kafka if self-hosted | Durable buffer between broker intake and database writes |
| Backend services | Node.js + NestJS (TypeScript end-to-end) | One language across stack lowers team overhead; strong typing shared via `shared-types` |
| Database | PostgreSQL (managed, e.g. RDS/Cloud SQL) with row-level security | Strong consistency for financial/legal-grade data; RLS enforces tenant isolation |
| Realtime (dashboard) | WebSocket via managed gateway (API Gateway WS / AppSync) | Avoids operating a stateful WS fleet at national scale |
| Cache | Redis (managed) | Sessions, rate limits, hot rollups |
| Object storage | S3-compatible | Irregularity media |
| Identity | Custom Identity Service issuing JWT (HQ) + device credentials (delegates), or Cognito/IoT Core built-ins if acceptable | Either works; custom gives full control over the phone-OTP delegate flow and per-device credential lifecycle |

This is a recommendation, not a hard requirement — flag if you'd prefer a different language/runtime, or a different broker/cloud, and the design will be adjusted accordingly.

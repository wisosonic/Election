# Deployment Plan

Reference cloud: **AWS** (chosen as a concrete example per the "let me choose" tech decision). The design maps to Azure/GCP equivalents in the mapping table at the end — swap the managed-service names, the architecture doesn't change.

## 1. Guiding principle

The **Delegate Module** and **Central Server Module** are deployed as two fully separate stacks. The Delegate Module has no backend of its own — deploying it means building and distributing a new signed Android APK (sideloaded, not via Google Play — see §3). The Central Server Module (MQTT broker, ingestion queue/workers, APIs, dashboard, database) is one IaC root, one CI/CD pipeline, and one release train, even though it's internally composed of several independently-scaling services. Neither module's deploy, rollback, or outage should require touching the other — the only thing connecting them at runtime is the MQTT broker's public endpoint (plus FCM for push, see §3).

## 2. Environments

| Environment | Purpose |
|---|---|
| `dev` | Ongoing development; run entirely against generated seed data (tenant/election/rooms/family records/voters/delegates) — see `docs/ARCHITECTURE.md` §5.6. Never real voter PII. |
| `staging` | Mirrors prod topology; used for the mandatory pre-election load-test rehearsal. Voter data is the generated seed set until the campaign supplies the real registry, at which point `staging` can be loaded with a redacted/synthetic-substitute copy rather than real voter PII, to keep pre-prod environments low-risk |
| `prod` | Live election data |

All three exist for both modules independently, so the Delegate Module can, e.g., ship a PWA hotfix to `prod` without redeploying the Central Server Module's `staging`.

## 3. Per-module deployment

### Delegate Module
- **Build**: React Native Android release build (Gradle `assembleRelease` or EAS Build if using Expo's managed workflow), producing a signed APK. No compute/ECS service to deploy — the module's entire runtime footprint is the installed app on each delegate's phone.
- **Signing**: release keystore held in AWS Secrets Manager (or a dedicated HSM/KMS-backed key), never committed to the repo; CI signs the APK as its last build step.
- **Distribution (private, sideloaded — confirmed, not Google Play)**: signed APK uploaded to an S3 bucket behind CloudFront, served only via short-lived signed URLs — no public page, no listing, no unauthenticated access. A delegate/coordinator gets their install (or update) link through a controlled HQ channel (e.g., sent via the Central Server Module after OTP-verified login, or distributed by the coordinator during onboarding), never a general broadcast link. Signed-URL expiry plus per-request logging (CloudTrail/S3 access logs) gives an audit trail of who fetched which build and when.
- **In-app update check**: since there's no Play Store to auto-update installs, the app pings a version endpoint on the Central Server Module at launch; if a newer signed build exists, it prompts the user to download and reinstall.
- **First-install friction**: sideloading requires enabling "install from unknown sources" on the device — this should be a scripted step in the pre-election delegate training/dry-run session, not left to be discovered on election morning.
- **Push notifications**: requires a Firebase project (FCM) for the app-closed/critical-alert fallback described in the architecture doc — this is the one piece of the stack that isn't AWS-native, since FCM is the only viable push channel for Android regardless of where the rest of the backend lives.
  - **Ownership is per-tenant**: each candidate campaign owns and pays for its own Firebase project (not one platform-wide project shared across tenants) — consistent with the multi-tenant model, and it keeps one campaign's push traffic/quota/billing fully separate from another's. The Central Server Module stores each tenant's FCM server key in Secrets Manager under a per-tenant path and sends through the matching project's credentials.
  - **Real credentials arrive later**: at this stage, `dev`/`staging` use a placeholder/test Firebase project so the push integration can be built and tested end-to-end; the actual campaign's Firebase project and its real server key get provisioned and swapped in as part of that tenant's go-live checklist, before election day, not before development starts.
  - This becomes a standing item in the **tenant onboarding process** (Section 5.2 of the architecture doc): a new campaign can't receive push-based alerts until its own Firebase credentials are supplied and stored — MQTT delivery to already-open app instances works regardless, so this only affects the app-closed fallback path.

### Central Server Module
- **MQTT broker**: AWS IoT Core (managed — no cluster to operate), configured with per-device X.509 certificates or IoT Custom Authorizer tokens, and topic-level IoT Policies enforcing each device can only pub/sub its own room's topics. If a non-AWS or self-hosted broker is required instead, substitute an EMQX or HiveMQ cluster (see §7 mapping) — this changes the ingestion glue in §3 below but not the rest of the architecture.
- **Ingestion**: IoT Core Rule Engine routes incoming topic messages to an SQS queue; **ingestion workers** (ECS Fargate) consume the queue, validate/dedupe, and write to Postgres. Dead-letter queue configured with alerting.
- **Command API + realtime-service**: ECS Fargate, autoscaled independently from the ingestion workers since dashboard read load and delegate submission bursts have different profiles.
- **Dashboard**: Next.js — static export to S3/CloudFront if no SSR is needed, or a small ECS Fargate service if SSR is used. Start static.
- **Identity Service**: small ECS Fargate service (low load, high-availability priority — multi-AZ minimum); also handles device credential issuance/revocation for the broker.
- **Database**: single RDS Postgres (Multi-AZ), tenant isolation via Row-Level Security + `tenant_id` on every table; revisit physical sharding only if a specific tenant's scale requires it.
- **Cache**: ElastiCache Redis, Multi-AZ.
- **Object storage**: S3 bucket for media, with lifecycle policy and versioning; pre-signed URL uploads only, no public bucket access.

## 4. Networking & security

- Single VPC, private subnets for ingestion workers, APIs, and the database; public-facing surface is only IoT Core's MQTT endpoint (port 8883), CloudFront (dashboard + private APK distribution), and the dashboard's ALB.
- IoT Core enforces device-level authentication and topic ACLs at the broker itself — this is now the primary security boundary for anything coming from a delegate device, replacing what would otherwise need a dedicated internet-facing API service.
- AWS WAF in front of both CloudFront distributions and the dashboard ALB — rate-based rules, geo-awareness, and bot protection, given the political sensitivity and realistic risk of targeted disruption attempts.
- AWS Shield (Standard at minimum; consider Advanced given the high-profile nature of election infrastructure) for DDoS protection. IoT Core itself is a managed, AWS-hardened endpoint, reducing the custom attack surface compared to a self-run broker.
- TLS everywhere: MQTT connections are MQTTS/WSS only (no unencrypted listener), CloudFront/ALB terminate TLS, service-to-service traffic inside the VPC uses TLS where it crosses trust boundaries.
- Secrets (DB credentials, JWT signing keys, SMS/OTP provider keys, broker CA material) in AWS Secrets Manager, injected at container start — never baked into images or committed to the repo.
- CloudTrail + centralized logging (CloudWatch Logs, or forward to a SIEM) for all infrastructure and application audit events, including IoT Core connection/auth logs and every read of voter-level PII (see `docs/ARCHITECTURE.md` §6.4) — retained beyond the election cycle for potential legal/dispute review.
- **Voter-level data retention is an open policy decision** (see `CLAUDE.md`): until it's settled, RDS automated backups/snapshots containing voter PII should follow the same retention window as the primary data, not a longer default — don't let backup retention silently outlive whatever policy gets decided.

## 5. CI/CD

- Two independent pipelines (e.g., GitHub Actions workflows):
  - **Delegate pipeline** — triggered by `apps/delegate-mobile/**`: lint/typecheck → unit tests → Android release build → sign APK → upload to the private S3/CloudFront distribution bucket per environment (no public access — signed URLs only). No container/ECS step at all.
  - **Central Server pipeline** — triggered by `services/**` or `apps/command-dashboard/**`: lint/typecheck → unit tests → build containers → push to ECR → deploy to `dev` automatically → manual promotion gate to `staging` → manual promotion gate to `prod`. IoT Core rule/policy changes are applied as part of this same pipeline's IaC step, since they're part of the Central Server Module.
- Blue/green or rolling deploy on ECS with health-check-gated cutover and automatic rollback on failed health checks.
- Database migrations run as a separate, reviewed step before service deploy (never auto-applied by application boot).

## 6. Election-day operational plan

- **Freeze window**: no non-critical deploys to `prod` in the 48–72 hours before election day; only pre-approved hotfixes.
- **Load rehearsal**: full-scale synthetic load test on `staging` — simulate the expected number of delegate MQTT connections publishing at realistic intervals for poll-open/midday/poll-close — at least one week before election day, repeated after any significant change.
- **War room**: on-call rotation covering both modules' owning teams, live dashboards for IoT Core connection count/auth failures, ingestion queue depth, error rates, and per-room publish-lag, visible throughout election day.
- **Rollback plan**: previous container image/task-definition revision kept ready for immediate redeploy on the Central Server Module; previous signed APK kept available at the distribution location so delegates can be told to reinstall it if a new build misbehaves.
- **Manual fallback**: paper tally-sheet procedure documented and communicated to delegates as a fallback of last resort if a room's connectivity and local device both fail — the offline-first design should make this rare, but it must exist given the stakes.

## 7. Cloud-provider mapping (if not AWS)

| AWS (reference) | Azure equivalent | GCP equivalent |
|---|---|---|
| IoT Core (MQTT broker) | Azure IoT Hub | Cloud IoT Core is retired — use a self-hosted EMQX/HiveMQ cluster, or Google Pub/Sub with a self-hosted MQTT bridge |
| ECS Fargate | Azure Container Apps / AKS | Cloud Run / GKE |
| RDS Postgres | Azure Database for PostgreSQL | Cloud SQL for PostgreSQL |
| ElastiCache Redis | Azure Cache for Redis | Memorystore |
| SQS | Azure Service Bus | Pub/Sub |
| S3 | Blob Storage | Cloud Storage |
| CloudFront | Azure Front Door/CDN | Cloud CDN |
| Secrets Manager | Key Vault | Secret Manager |
| WAF/Shield | Azure Front Door WAF / DDoS Protection | Cloud Armor |

## 8. Open items requiring your input before infra is provisioned

- Confirm broker choice: managed AWS IoT Core (recommended, least operational overhead) vs. a self-hosted MQTT cluster (needed if avoiding AWS lock-in on this specific piece, or deploying outside AWS).
- Confirm target AWS region (or confirm Azure/GCP instead) based on measured latency from Lebanese carriers, since MQTT is a persistent-connection protocol and is more latency-sensitive than stateless HTTPS.
- Confirm SMS/OTP provider for delegate authentication (must reliably deliver to Lebanese mobile numbers — provider choice affects cost and reliability materially).
- Confirm data residency/legal requirements, if any, for where election-related data may be stored.
- Confirm expected scale numbers (approx. # tenants, # voting centers/rooms per tenant, # delegates per room, # voters per room) so broker connection limits, autoscaling floors/ceilings, and load-test targets can be set concretely rather than assumed.

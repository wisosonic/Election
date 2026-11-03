import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { createDb, Db, schema, withTenant } from '@election/db';
import { assertSeedAllowed } from './guard';
import { intBetween, mulberry32, pick } from './rng';

const FIRST_NAMES = ['Ahmad', 'Rana', 'Karim', 'Layla', 'Rami', 'Nour', 'Omar', 'Maya', 'Ziad', 'Dana'];
const FATHER_NAMES = ['Michel', 'Georges', 'Hassan', 'Fadi', 'Elie', 'Walid', 'Tony', 'Samir'];

export interface SeedOptions {
  seed?: number;
  mohafazatCount?: number;
  qadasPerMohafazat?: number;
  centersPerQada?: number;
  roomsPerCenter?: number;
  familiesPerRoom?: number;
  hqPassword?: string;
}

export interface SeedResult {
  tenantId: string;
  electionId: string;
  roomIds: string[];
  delegates: { userId: string; phone: string; roomId: string }[];
  hqUsers: { userId: string; email: string; password: string; totpSecret: string; role: string }[];
}

/** §5.6: generates a full synthetic hierarchy (mohafazat -> qada -> voting
 * center -> room -> registry ranges -> family records -> voters) plus the
 * supporting tenant/election/delegate/HQ-user context, so dev/staging can
 * exercise the real data shape without the real registry (which the campaign
 * supplies later -- see CLAUDE.md). Deterministic given the same `seed`. */
export async function runSeed(db: Db, opts: SeedOptions = {}): Promise<SeedResult> {
  assertSeedAllowed();

  const rng = mulberry32(opts.seed ?? 42);
  const mohafazatCount = opts.mohafazatCount ?? 1;
  const qadasPerMohafazat = opts.qadasPerMohafazat ?? 2;
  const centersPerQada = opts.centersPerQada ?? 2;
  const roomsPerCenter = opts.roomsPerCenter ?? 2;
  const familiesPerRoom = opts.familiesPerRoom ?? 5;
  const hqPassword = opts.hqPassword ?? 'seed-password-change-me';

  const tenantId = randomUUID();
  const electionId = randomUUID();
  const roomIds: string[] = [];
  const delegates: SeedResult['delegates'] = [];
  let registryCursor = 10_000; // monotonically increasing so ranges never overlap across rooms

  await db.insert(schema.tenants).values({ id: tenantId, name: 'Seeded Campaign' });

  await withTenant(db, tenantId, async (tx) => {
    await tx.insert(schema.elections).values({ id: electionId, tenantId, electionDate: '2026-05-15', name: 'Seed Election' });

    for (let m = 0; m < mohafazatCount; m++) {
      const mohafazatId = randomUUID();
      await tx.insert(schema.mohafazats).values({ id: mohafazatId, tenantId, electionId, name: `Mohafazat ${m + 1}` });

      for (let q = 0; q < qadasPerMohafazat; q++) {
        const qadaId = randomUUID();
        await tx.insert(schema.qadas).values({ id: qadaId, tenantId, mohafazatId, name: `Qada ${m + 1}-${q + 1}` });

        for (let c = 0; c < centersPerQada; c++) {
          const centerId = randomUUID();
          await tx.insert(schema.votingCenters).values({
            id: centerId,
            tenantId,
            qadaId,
            name: `Public School ${m + 1}-${q + 1}-${c + 1}`,
            address: `Main Street ${m + 1}-${q + 1}-${c + 1}`,
          });

          for (let r = 0; r < roomsPerCenter; r++) {
            const roomId = randomUUID();
            roomIds.push(roomId);
            await tx.insert(schema.rooms).values({ id: roomId, tenantId, votingCenterId: centerId, label: `Room ${r + 1}` });

            const rangeStart = registryCursor;
            const rangeEnd = registryCursor + familiesPerRoom * 10;
            registryCursor = rangeEnd + 1;
            await tx.insert(schema.roomRegistryRanges).values({
              id: randomUUID(),
              tenantId,
              roomId,
              registryRangeStart: rangeStart,
              registryRangeEnd: rangeEnd,
            });

            for (let f = 0; f < familiesPerRoom; f++) {
              const registryNumber = rangeStart + f * 10 + intBetween(rng, 0, 5);
              const familyId = randomUUID();
              await tx.insert(schema.familyRecords).values({ id: familyId, tenantId, registryNumber, roomId });

              const memberCount = intBetween(rng, 1, 4);
              for (let v = 0; v < memberCount; v++) {
                await tx.insert(schema.voterRecords).values({
                  id: randomUUID(),
                  tenantId,
                  familyRecordId: familyId,
                  name: `${pick(rng, FIRST_NAMES)} ${pick(rng, FATHER_NAMES)}`,
                  disambiguation: { fatherName: pick(rng, FATHER_NAMES) },
                });
              }
            }

            // One delegate per room, synthetic Lebanese-format phone number.
            const delegateId = randomUUID();
            const phone = `+9613${intBetween(rng, 100000, 999999)}`;
            await tx.insert(schema.users).values({ id: delegateId, tenantId, role: 'delegate', phone, authMethod: 'otp' });
            await tx.insert(schema.delegateAssignments).values({ id: randomUUID(), tenantId, delegateId, roomId });
            delegates.push({ userId: delegateId, phone, roomId });
          }
        }
      }
    }
  });

  const hqUsers: SeedResult['hqUsers'] = [];
  for (const role of ['campaign_admin', 'coordinator', 'analyst'] as const) {
    const userId = randomUUID();
    const email = `${role}@seed.example`;
    const totpSecret = authenticator.generateSecret();
    await withTenant(db, tenantId, (tx) =>
      tx.insert(schema.users).values({
        id: userId,
        tenantId,
        role,
        email,
        authMethod: 'password_totp',
        passwordHash: bcrypt.hashSync(hqPassword, 10),
        totpSecret,
      }),
    );
    hqUsers.push({ userId, email, password: hqPassword, totpSecret, role });
  }

  return { tenantId, electionId, roomIds, delegates, hqUsers };
}

/* istanbul ignore next -- CLI entrypoint, not exercised by unit tests */
if (require.main === module) {
  void (async () => {
    const { db, close } = await createDb(process.env.DATABASE_URL);
    try {
      const result = await runSeed(db);
      // eslint-disable-next-line no-console
      console.log(`Seeded tenant ${result.tenantId} with ${result.roomIds.length} rooms and ${result.delegates.length} delegates.`);
      // eslint-disable-next-line no-console
      console.log('HQ logins:', result.hqUsers.map((u) => `${u.role}: ${u.email} / ${u.password}`).join('\n'));
    } finally {
      await close();
    }
  })();
}

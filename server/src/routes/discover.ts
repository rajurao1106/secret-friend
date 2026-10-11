import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, notInArray, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  blocks,
  hobbies,
  kundaliMatches,
  profiles,
  userHobbies,
  users,
} from '../schema/index.js';
import type { KundaliMatchQueue } from '../services/kundali-match-queue.js';
import type { KundaliService } from '../services/kundali.js';
import { scoreGunaMilan } from '../services/kundali.js';

const genderSchema = z.enum(['male', 'female', 'other']);
const discoverQuerySchema = z.object({
  kundali: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  minScore: z.coerce.number().int().min(0).max(36).default(0),
  gender: genderSchema.optional(),
  hobbies: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? [] : value.split(',')))
    .pipe(z.array(z.string().uuid()).max(50)),
});
const cacheDetailsSchema = z.object({
  userADataHash: z.string(),
  userBDataHash: z.string(),
  breakdown: z.object({
    varna: z.number(),
    vashya: z.number(),
    tara: z.number(),
    yoni: z.number(),
    grahaMaitri: z.number(),
    gana: z.number(),
    bhakoot: z.number(),
    nadi: z.number(),
  }),
});

interface DiscoverRouteOptions {
  readonly kundaliService: KundaliService;
  readonly queue: KundaliMatchQueue;
}

function hashBirthData(data: {
  readonly dob: string;
  readonly birthTime: string;
  readonly lat: number;
  readonly lng: number;
  readonly timezone: string;
}): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export const discoverRoutes: FastifyPluginAsync<DiscoverRouteOptions> = async (
  app,
  options,
) => {
  app.get('/discover', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = discoverQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid discover filters' });
    }
    const filters = parsed.data;
    if (filters.minScore > 0 && !filters.kundali) {
      return reply.code(400).send({ error: 'minScore requires kundali=true' });
    }
    if (filters.kundali && !options.kundaliService.configured) {
      return reply.code(503).send({
        error: 'Kundali chart calculations are not configured',
        message: 'Compatibility scoring supports supplied charts; configure a chart provider to enable it.',
      });
    }

    const excluded = await app.db
      .select({ id: blocks.blockedId })
      .from(blocks)
      .where(eq(blocks.blockerId, request.user.sub));
    const blockedBy = await app.db
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(eq(blocks.blockedId, request.user.sub));
    const excludedIds = [
      request.user.sub,
      ...excluded.map(({ id }) => id),
      ...blockedBy.map(({ id }) => id),
    ];

    const conditions = [
      eq(users.isActive, true),
      notInArray(users.id, excludedIds),
    ];
    if (filters.gender !== undefined) {
      conditions.push(eq(users.gender, filters.gender));
    }
    const candidates = await app.db
      .select({
        id: users.id,
        gender: users.gender,
        avatarIndex: users.avatarIndex,
        createdAt: users.createdAt,
        nickname: profiles.nickname,
        dob: profiles.dob,
        birthTime: profiles.birthTime,
        birthLat: profiles.birthLat,
        birthLng: profiles.birthLng,
        birthTz: profiles.birthTz,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(100);

    let currentBirth:
      | {
          dob: string;
          birthTime: string;
          birthLat: number;
          birthLng: number;
          birthTz: string;
        }
      | undefined;
    let currentHash: string | undefined;
    if (filters.kundali) {
      const [profile] = await app.db
        .select({
          dob: profiles.dob,
          birthTime: profiles.birthTime,
          birthLat: profiles.birthLat,
          birthLng: profiles.birthLng,
          birthTz: profiles.birthTz,
        })
        .from(profiles)
        .where(eq(profiles.userId, request.user.sub))
        .limit(1);
      if (
        profile?.dob === null ||
        profile?.birthTime === null ||
        profile?.birthLat === null ||
        profile?.birthLng === null ||
        profile?.birthTz === null ||
        profile === undefined
      ) {
        return reply.code(409).send({
          error: 'Complete your birth details to use compatibility matching',
        });
      }
      currentBirth = {
        dob: profile.dob,
        birthTime: profile.birthTime,
        birthLat: profile.birthLat,
        birthLng: profile.birthLng,
        birthTz: profile.birthTz,
      };
      currentHash = hashBirthData({
        dob: profile.dob,
        birthTime: profile.birthTime,
        lat: profile.birthLat,
        lng: profile.birthLng,
        timezone: profile.birthTz,
      });
    }

    const candidateIds = candidates.map(({ id }) => id);
    const userHobbyRows =
      candidateIds.length === 0
        ? []
        : await app.db
            .select({
              userId: userHobbies.userId,
              id: hobbies.id,
              name: hobbies.name,
            })
            .from(userHobbies)
            .innerJoin(hobbies, eq(userHobbies.hobbyId, hobbies.id))
            .where(inArray(userHobbies.userId, candidateIds));
    const hobbiesByUser = new Map<string, { id: string; name: string }[]>();
    for (const row of userHobbyRows) {
      const existing = hobbiesByUser.get(row.userId) ?? [];
      existing.push({ id: row.id, name: row.name });
      hobbiesByUser.set(row.userId, existing);
    }
    const filteredCandidates = candidates.filter((candidate) => {
      if (filters.hobbies.length === 0) return true;
      const candidateHobbies = hobbiesByUser.get(candidate.id) ?? [];
      return filters.hobbies.every((id) => candidateHobbies.some((hobby) => hobby.id === id));
    });

    if (!filters.kundali || currentBirth === undefined || currentHash === undefined) {
      return reply.send({
        items: filteredCandidates.map((candidate) => ({
          id: candidate.id,
          nickname: candidate.nickname,
          gender: candidate.gender,
          avatarIndex: candidate.avatarIndex,
          createdAt: candidate.createdAt,
          hobbies: hobbiesByUser.get(candidate.id) ?? [],
        })),
        calculating: false,
      });
    }

    const pairConditions = filteredCandidates.map((candidate) => {
      const userA = request.user.sub < candidate.id ? request.user.sub : candidate.id;
      const userB = request.user.sub < candidate.id ? candidate.id : request.user.sub;
      return and(eq(kundaliMatches.userA, userA), eq(kundaliMatches.userB, userB));
    });
    const cachedMatches =
      pairConditions.length === 0
        ? []
        : await app.db
            .select()
            .from(kundaliMatches)
            .where(or(...pairConditions));
    const cacheByCandidate = new Map(
      cachedMatches.map((match) => [
        match.userA === request.user.sub ? match.userB : match.userA,
        match,
      ]),
    );

    const calculationPendingIds = new Set<string>();
    const items = await Promise.all(
      filteredCandidates.map(async (candidate, candidateIndex) => {
        const candidateBirth =
          candidate.dob !== null &&
          candidate.birthTime !== null &&
          candidate.birthLat !== null &&
          candidate.birthLng !== null &&
          candidate.birthTz !== null
            ? {
                dob: candidate.dob,
                birthTime: candidate.birthTime,
                birthLat: candidate.birthLat,
                birthLng: candidate.birthLng,
                birthTz: candidate.birthTz,
              }
            : undefined;
        const candidateHash =
          candidateBirth === undefined
            ? undefined
            : hashBirthData({
                dob: candidateBirth.dob,
                birthTime: candidateBirth.birthTime,
                lat: candidateBirth.birthLat,
                lng: candidateBirth.birthLng,
                timezone: candidateBirth.birthTz,
              });
        const cached = cacheByCandidate.get(candidate.id);
        const cacheDetails = cached === undefined
          ? undefined
          : cacheDetailsSchema.safeParse(cached.details);
        const hashesFresh =
          candidateHash !== undefined &&
          currentHash !== undefined &&
          cacheDetails?.success === true &&
          cached !== undefined &&
          ((cached.userA === request.user.sub &&
            cacheDetails.data.userADataHash === currentHash &&
            cacheDetails.data.userBDataHash === candidateHash) ||
            (cached.userB === request.user.sub &&
              cacheDetails.data.userBDataHash === currentHash &&
              cacheDetails.data.userADataHash === candidateHash));

        if (
          !hashesFresh &&
          candidateBirth !== undefined &&
          candidateHash !== undefined &&
          candidateIndex < 25
        ) {
          const aId = request.user.sub < candidate.id ? request.user.sub : candidate.id;
          const bId = request.user.sub < candidate.id ? candidate.id : request.user.sub;
          const aBirth = aId === request.user.sub ? currentBirth : candidateBirth;
          const bBirth = bId === request.user.sub ? currentBirth : candidateBirth;
          const aHash = aId === request.user.sub ? currentHash : candidateHash;
          const bHash = bId === request.user.sub ? currentHash : candidateHash;
          const queued = options.queue.enqueue(
            `${aId}:${bId}:${aHash}:${bHash}`,
            async () => {
              const [chartA, chartB] = await Promise.all([
                options.kundaliService.getChart({
                  dob: aBirth.dob,
                  birthTime: aBirth.birthTime,
                  lat: aBirth.birthLat,
                  lng: aBirth.birthLng,
                  timezone: aBirth.birthTz,
                }),
                options.kundaliService.getChart({
                  dob: bBirth.dob,
                  birthTime: bBirth.birthTime,
                  lat: bBirth.birthLat,
                  lng: bBirth.birthLng,
                  timezone: bBirth.birthTz,
                }),
              ]);
              const score = scoreGunaMilan(chartA, chartB);
              await app.db
                .insert(kundaliMatches)
                .values({
                  userA: aId,
                  userB: bId,
                  score: score.total,
                  details: {
                    userADataHash: aHash,
                    userBDataHash: bHash,
                    breakdown: score.breakdown,
                  },
                })
                .onConflictDoUpdate({
                  target: [kundaliMatches.userA, kundaliMatches.userB],
                  set: {
                    score: score.total,
                    details: {
                      userADataHash: aHash,
                      userBDataHash: bHash,
                      breakdown: score.breakdown,
                    },
                    calculatedAt: new Date(),
                  },
                });
            },
            (error) => app.log.error({ err: error, candidateId: candidate.id }, 'Compatibility calculation failed'),
          );
          if (queued) calculationPendingIds.add(candidate.id);
        }

        const hasFreshScore =
          hashesFresh && cached !== undefined && cacheDetails?.success === true;
        if (filters.minScore > 0 && (!hasFreshScore || cached.score < filters.minScore)) {
          return undefined;
        }
        return {
          id: candidate.id,
          nickname: candidate.nickname,
          gender: candidate.gender,
          avatarIndex: candidate.avatarIndex,
          createdAt: candidate.createdAt,
          hobbies: hobbiesByUser.get(candidate.id) ?? [],
          compatibility: hasFreshScore
            ? { total: cached.score, breakdown: cacheDetails.data.breakdown }
            : null,
        };
      }),
    );

    const visibleItems = items
      .filter((item) => item !== undefined)
      .sort((first, second) => {
        const firstScore = first.compatibility?.total ?? -1;
        const secondScore = second.compatibility?.total ?? -1;
        return secondScore - firstScore || second.createdAt.getTime() - first.createdAt.getTime();
      });
    return reply.send({
      items: visibleItems,
      calculating: calculationPendingIds.size > 0,
    });
  });
};

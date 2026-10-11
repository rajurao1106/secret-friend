import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  hobbies,
  media,
  profiles,
  reveals,
  sports,
  userHobbies,
  userSports,
  users,
} from '../schema/index.js';
import type { GeocodingService } from '../services/geocoding.js';
import type { MediaStorage } from '../services/media-storage.js';
import { hasReveal } from '../services/reveal-access.js';
import { areUsersBlocked } from '../services/conversation-access.js';
import { isAdult } from '../services/profile-validation.js';

export interface ProfileRouteOptions {
  readonly geocoding: GeocodingService;
  readonly storage: MediaStorage;
}

const genderSchema = z.enum(['male', 'female', 'other']);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');
const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(40),
  gender: genderSchema,
  dob: isoDateSchema,
  birthTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  birthPlace: z.string().trim().min(2).max(200).optional(),
  bio: z.string().trim().max(500).optional(),
  hobbies: z.array(z.string().uuid()).max(50).default([]),
  sports: z.array(z.string().uuid()).max(50).default([]),
});
const settingsSchema = z.object({
  shareMobile: z.boolean(),
});
const placeSearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
});

export const profileRoutes: FastifyPluginAsync<ProfileRouteOptions> = async (
  app,
  options,
) => {
  app.post('/me/consent', { preHandler: app.authenticate }, async (request, reply) => {
    const [profile] = await app.db
      .insert(profiles)
      .values({
        userId: request.user.sub,
        consentAt: new Date(),
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { consentAt: new Date() },
      })
      .returning({ consentAt: profiles.consentAt });

    if (profile === undefined) {
      throw new Error('Failed to record consent');
    }
    return reply.send({ consentAt: profile.consentAt });
  });

  app.put('/me/profile', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid profile',
        details: parsed.error.issues,
      });
    }

    const input = parsed.data;
    if (!isAdult(input.dob)) {
      return reply.code(400).send({ error: 'Users must be at least 18 years old' });
    }

    const includesBirthData =
      input.birthTime !== undefined || input.birthPlace !== undefined;
    const [currentProfile] = await app.db
      .select({ consentAt: profiles.consentAt })
      .from(profiles)
      .where(eq(profiles.userId, request.user.sub))
      .limit(1);
    if (
      includesBirthData &&
      (currentProfile?.consentAt === null || currentProfile === undefined)
    ) {
      return reply.code(403).send({ error: 'Birth data consent is required' });
    }

    if (input.hobbies.length > 0) {
      const existingHobbies = await app.db
        .select({ id: hobbies.id })
        .from(hobbies)
        .where(inArray(hobbies.id, input.hobbies));
      if (existingHobbies.length !== new Set(input.hobbies).size) {
        return reply.code(400).send({ error: 'One or more hobbies do not exist' });
      }
    }
    if (input.sports.length > 0) {
      const existingSports = await app.db
        .select({ id: sports.id })
        .from(sports)
        .where(inArray(sports.id, input.sports));
      if (existingSports.length !== new Set(input.sports).size) {
        return reply.code(400).send({ error: 'One or more sports do not exist' });
      }
    }

    let place: Awaited<ReturnType<GeocodingService['search']>>[number] | undefined;
    if (input.birthPlace !== undefined) {
      const candidates = await options.geocoding.search(input.birthPlace);
      place = candidates[0];
      if (place === undefined) {
        return reply.code(400).send({ error: 'Birth place could not be found' });
      }
    }

    await app.db.transaction(async (tx) => {
      await tx
        .insert(profiles)
        .values({
          userId: request.user.sub,
          nickname: input.nickname,
          dob: input.dob,
          birthTime: input.birthTime,
          birthPlace: place?.name ?? input.birthPlace,
          birthLat: place?.lat,
          birthLng: place?.lng,
          birthTz: place?.timezone,
          bio: input.bio,
        })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: {
            nickname: input.nickname,
            dob: input.dob,
            birthTime: input.birthTime,
            birthPlace: place?.name ?? input.birthPlace,
            birthLat: place?.lat,
            birthLng: place?.lng,
            birthTz: place?.timezone,
            bio: input.bio,
          },
        });
      await tx.update(users).set({ gender: input.gender }).where(eq(users.id, request.user.sub));

      await tx.delete(userHobbies).where(eq(userHobbies.userId, request.user.sub));
      if (input.hobbies.length > 0) {
        await tx.insert(userHobbies).values(
          input.hobbies.map((hobbyId) => ({
            userId: request.user.sub,
            hobbyId,
          })),
        );
      }

      await tx.delete(userSports).where(eq(userSports.userId, request.user.sub));
      if (input.sports.length > 0) {
        await tx.insert(userSports).values(
          input.sports.map((sportId) => ({
            userId: request.user.sub,
            sportId,
          })),
        );
      }
    });

    return reply.send({ saved: true });
  });

  app.get('/me', { preHandler: app.authenticate }, async (request, reply) => {
    const [record] = await app.db
      .select({
        id: users.id,
        mobile: users.mobile,
        gender: users.gender,
        avatarIndex: users.avatarIndex,
        createdAt: users.createdAt,
        profile: profiles,
      })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(users.id, request.user.sub))
      .limit(1);
    if (record === undefined) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const [userHobbyRows, userSportRows] = await Promise.all([
      app.db
        .select({ id: hobbies.id, name: hobbies.name })
        .from(userHobbies)
        .innerJoin(hobbies, eq(userHobbies.hobbyId, hobbies.id))
        .where(eq(userHobbies.userId, request.user.sub)),
      app.db
        .select({ id: sports.id, name: sports.name })
        .from(userSports)
        .innerJoin(sports, eq(userSports.sportId, sports.id))
        .where(eq(userSports.userId, request.user.sub)),
    ]);

    return reply.send({
      ...record,
      profile: record.profile ?? null,
      hobbies: userHobbyRows,
      sports: userSportRows,
    });
  });

  app.patch('/me/settings', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid settings' });
    }
    const [settings] = await app.db
      .insert(profiles)
      .values({ userId: request.user.sub, shareMobile: parsed.data.shareMobile })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { shareMobile: parsed.data.shareMobile },
      })
      .returning({ shareMobile: profiles.shareMobile });
    return reply.send(settings);
  });

  app.get('/hobbies', async () =>
    app.db.select({ id: hobbies.id, name: hobbies.name }).from(hobbies).orderBy(hobbies.name),
  );
  app.get('/sports', async () =>
    app.db.select({ id: sports.id, name: sports.name }).from(sports).orderBy(sports.name),
  );
  app.get('/places/search', async (request, reply) => {
    const parsed = placeSearchSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Search query must be 2-120 characters' });
    }
    return reply.send(await options.geocoding.search(parsed.data.q));
  });

  app.get<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsedId = z.string().uuid().safeParse(request.params.id);
      if (!parsedId.success) {
        return reply.code(400).send({ error: 'Invalid user id' });
      }
      if (parsedId.data === request.user.sub) {
        return reply.code(400).send({ error: 'Use GET /me for your own profile' });
      }
      if (await areUsersBlocked(app.db, request.user.sub, parsedId.data)) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const [record] = await app.db
        .select({
          id: users.id,
          gender: users.gender,
          avatarIndex: users.avatarIndex,
          nickname: profiles.nickname,
          shareMobile: profiles.shareMobile,
          bio: profiles.bio,
          profilePhotoKey: profiles.profilePhotoKey,
        })
        .from(users)
        .innerJoin(profiles, eq(users.id, profiles.userId))
        .where(and(eq(users.id, parsedId.data), eq(users.isActive, true)))
        .limit(1);
      if (record === undefined) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const [hobbyRows, sportRows] = await Promise.all([
        app.db
          .select({ id: hobbies.id, name: hobbies.name })
          .from(userHobbies)
          .innerJoin(hobbies, eq(userHobbies.hobbyId, hobbies.id))
          .where(eq(userHobbies.userId, parsedId.data)),
        app.db
          .select({ id: sports.id, name: sports.name })
          .from(userSports)
          .innerJoin(sports, eq(userSports.sportId, sports.id))
          .where(eq(userSports.userId, parsedId.data)),
      ]);
      const publicProfile = {
        id: record.id,
        nickname: record.nickname,
        gender: record.gender,
        avatarIndex: record.avatarIndex,
        hobbies: hobbyRows,
        sports: sportRows,
      };

      if (!(await hasReveal(app.db, request.user.sub, record.id))) {
        return reply.send({ ...publicProfile, revealed: false });
      }

      const [revealedProfile] = await app.db
        .select({ mobile: users.mobile })
        .from(users)
        .where(eq(users.id, record.id))
        .limit(1);
      const gallery = await app.db
        .select({ id: media.id, key: media.key })
        .from(media)
        .where(and(eq(media.ownerId, record.id), eq(media.kind, 'gallery')));
      if (
        (record.profilePhotoKey !== null || gallery.length > 0) &&
        !options.storage.configured
      ) {
        return reply.code(503).send({ error: 'Media storage is not configured' });
      }

      return reply.send({
        ...publicProfile,
        revealed: true,
        bio: record.bio,
        profilePhotoUrl:
          record.profilePhotoKey === null
            ? null
            : await options.storage.presignDownload(record.profilePhotoKey, 300),
        gallery: await Promise.all(
          gallery.map(async ({ id, key }) => ({
            id,
            url: await options.storage.presignDownload(key, 300),
          })),
        ),
        ...(record.shareMobile && revealedProfile !== undefined
          ? { mobile: revealedProfile.mobile }
          : {}),
      });
    },
  );
};

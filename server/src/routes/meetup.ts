import { and, count, desc, eq, gte, notInArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { blocks, conversations, profiles, users } from '../schema/index.js';
import {
  meetupParticipations,
  meetupRequests,
  userPresence,
} from '../schema/meetup.js';
import { areUsersBlocked } from '../services/conversation-access.js';
import { getMeetupTime } from '../services/meetup-time.js';

const presenceWindowMs = 75_000;
const interestSchema = z.object({
  interested: z.boolean(),
  quickReply: z.boolean().default(false),
});
const requestSchema = z.object({ userId: z.string().uuid() });
const requestListSchema = z.object({ type: z.enum(['received', 'sent']).default('received') });

async function getOnlineCount(db: AppDatabase, eventDate: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(meetupParticipations)
    .innerJoin(users, eq(users.id, meetupParticipations.userId))
    .innerJoin(userPresence, eq(userPresence.userId, meetupParticipations.userId))
    .where(
      and(
        eq(meetupParticipations.eventDate, eventDate),
        eq(meetupParticipations.interested, true),
        eq(users.isActive, true),
        sql`${meetupParticipations.checkedInAt} is not null`,
        gte(userPresence.lastSeenAt, new Date(Date.now() - presenceWindowMs)),
      ),
    );
  return row?.total ?? 0;
}

export const meetupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/meetup/today', { preHandler: app.authenticate }, async (request) => {
    const { eventDate, started } = getMeetupTime();
    const [counts] = await app.db
      .select({ total: count() })
      .from(meetupParticipations)
      .where(
        and(
          eq(meetupParticipations.eventDate, eventDate),
          eq(meetupParticipations.interested, true),
        ),
      );
    const [mine] = await app.db
      .select({
        interested: meetupParticipations.interested,
        quickReply: meetupParticipations.quickReply,
        checkedInAt: meetupParticipations.checkedInAt,
      })
      .from(meetupParticipations)
      .where(
        and(
          eq(meetupParticipations.eventDate, eventDate),
          eq(meetupParticipations.userId, request.user.sub),
        ),
      )
      .limit(1);

    return {
      eventDate,
      started,
      interestedCount: counts?.total ?? 0,
      onlineCount: started ? await getOnlineCount(app.db, eventDate) : 0,
      interested: mine?.interested ?? false,
      quickReply: mine?.quickReply ?? false,
      checkedIn: mine?.checkedInAt != null,
    };
  });

  app.put(
    '/meetup/interest',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = interestSchema.safeParse(request.body);
      if (!input.success) {
        return reply.code(400).send({ error: 'Invalid meetup preference' });
      }
      const { eventDate } = getMeetupTime();
      const [participation] = await app.db
        .insert(meetupParticipations)
        .values({
          eventDate,
          userId: request.user.sub,
          interested: input.data.interested,
          quickReply: input.data.interested && input.data.quickReply,
          checkedInAt: null,
        })
        .onConflictDoUpdate({
          target: [meetupParticipations.eventDate, meetupParticipations.userId],
          set: {
            interested: input.data.interested,
            quickReply: input.data.interested && input.data.quickReply,
            ...(input.data.interested ? {} : { checkedInAt: null }),
          },
        })
        .returning({
          interested: meetupParticipations.interested,
          quickReply: meetupParticipations.quickReply,
        });
      return reply.send(participation);
    },
  );

  app.post(
    '/meetup/check-in',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { eventDate, started } = getMeetupTime();
      if (!started) {
        return reply.code(409).send({ error: 'The meetup starts at 8 PM India time' });
      }
      const [participation] = await app.db
        .update(meetupParticipations)
        .set({ checkedInAt: new Date() })
        .where(
          and(
            eq(meetupParticipations.eventDate, eventDate),
            eq(meetupParticipations.userId, request.user.sub),
            eq(meetupParticipations.interested, true),
          ),
        )
        .returning({ userId: meetupParticipations.userId });
      if (participation === undefined) {
        return reply.code(409).send({ error: 'Mark yourself interested before checking in' });
      }
      await app.db
        .insert(userPresence)
        .values({ userId: request.user.sub, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: userPresence.userId,
          set: { lastSeenAt: new Date() },
        });
      return reply.send({ checkedIn: true });
    },
  );

  app.post(
    '/meetup/presence',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { eventDate, started } = getMeetupTime();
      if (!started) {
        return reply.code(409).send({ error: 'The meetup is not active' });
      }
      const [participation] = await app.db
        .select({ userId: meetupParticipations.userId })
        .from(meetupParticipations)
        .where(
          and(
            eq(meetupParticipations.eventDate, eventDate),
            eq(meetupParticipations.userId, request.user.sub),
            eq(meetupParticipations.interested, true),
            sql`${meetupParticipations.checkedInAt} is not null`,
          ),
        )
        .limit(1);
      if (participation === undefined) {
        return reply.code(403).send({ error: 'Check in to the meetup first' });
      }
      await app.db
        .insert(userPresence)
        .values({ userId: request.user.sub, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: userPresence.userId,
          set: { lastSeenAt: new Date() },
        });
      return reply.code(204).send();
    },
  );

  app.get('/meetup/online', { preHandler: app.authenticate }, async (request, reply) => {
    const { eventDate, started } = getMeetupTime();
    if (!started) {
      return reply.code(409).send({ error: 'The meetup starts at 8 PM India time' });
    }
    const [participation] = await app.db
      .select({ userId: meetupParticipations.userId })
      .from(meetupParticipations)
      .where(
        and(
          eq(meetupParticipations.eventDate, eventDate),
          eq(meetupParticipations.userId, request.user.sub),
          eq(meetupParticipations.interested, true),
          sql`${meetupParticipations.checkedInAt} is not null`,
        ),
      )
      .limit(1);
    if (participation === undefined) {
      return reply.code(403).send({ error: 'Check in to the meetup to see who is online' });
    }
    const blockedByMe = await app.db
      .select({ id: blocks.blockedId })
      .from(blocks)
      .where(eq(blocks.blockerId, request.user.sub));
    const blockedMe = await app.db
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(eq(blocks.blockedId, request.user.sub));
    const excludedIds = [
      request.user.sub,
      ...blockedByMe.map(({ id }) => id),
      ...blockedMe.map(({ id }) => id),
    ];
    const onlineSince = new Date(Date.now() - presenceWindowMs);
    const items = await app.db
      .select({
        id: users.id,
        nickname: profiles.nickname,
        avatarIndex: users.avatarIndex,
        quickReply: meetupParticipations.quickReply,
      })
      .from(meetupParticipations)
      .innerJoin(users, eq(users.id, meetupParticipations.userId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .innerJoin(userPresence, eq(userPresence.userId, users.id))
      .where(
        and(
          eq(meetupParticipations.eventDate, eventDate),
          eq(meetupParticipations.interested, true),
          eq(users.isActive, true),
          sql`${meetupParticipations.checkedInAt} is not null`,
          gte(userPresence.lastSeenAt, onlineSince),
          notInArray(users.id, excludedIds),
        ),
      )
      .orderBy(desc(meetupParticipations.quickReply), desc(userPresence.lastSeenAt))
      .limit(100);
    return reply.send({ items, onlineCount: await getOnlineCount(app.db, eventDate) });
  });

  app.post(
    '/meetup/requests',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = requestSchema.safeParse(request.body);
      if (!input.success || input.data.userId === request.user.sub) {
        return reply.code(400).send({ error: 'Invalid meetup request' });
      }
      const { eventDate, started } = getMeetupTime();
      if (!started) {
        return reply.code(409).send({ error: 'The meetup starts at 8 PM India time' });
      }
      const [participants] = await app.db
        .select({ userId: meetupParticipations.userId })
        .from(meetupParticipations)
        .innerJoin(userPresence, eq(userPresence.userId, meetupParticipations.userId))
        .innerJoin(users, eq(users.id, meetupParticipations.userId))
        .where(
          and(
            eq(meetupParticipations.eventDate, eventDate),
            eq(meetupParticipations.userId, request.user.sub),
            eq(meetupParticipations.interested, true),
            eq(users.isActive, true),
            sql`${meetupParticipations.checkedInAt} is not null`,
            gte(userPresence.lastSeenAt, new Date(Date.now() - presenceWindowMs)),
          ),
        )
        .limit(1);
      const [recipient] = await app.db
        .select({ userId: meetupParticipations.userId })
        .from(meetupParticipations)
        .innerJoin(userPresence, eq(userPresence.userId, meetupParticipations.userId))
        .innerJoin(users, eq(users.id, meetupParticipations.userId))
        .where(
          and(
            eq(meetupParticipations.eventDate, eventDate),
            eq(meetupParticipations.userId, input.data.userId),
            eq(meetupParticipations.interested, true),
            eq(users.isActive, true),
            sql`${meetupParticipations.checkedInAt} is not null`,
            gte(userPresence.lastSeenAt, new Date(Date.now() - presenceWindowMs)),
          ),
        )
        .limit(1);
      if (participants === undefined || recipient === undefined) {
        return reply.code(409).send({ error: 'Both users must be online at the meetup' });
      }
      if (await areUsersBlocked(app.db, request.user.sub, input.data.userId)) {
        return reply.code(403).send({ error: 'User is unavailable' });
      }

      const [result] = await app.db
        .insert(meetupRequests)
        .values({
          eventDate,
          fromUser: request.user.sub,
          toUser: input.data.userId,
        })
        .onConflictDoNothing({
          target: [
            meetupRequests.eventDate,
            meetupRequests.fromUser,
            meetupRequests.toUser,
          ],
        })
        .returning();
      if (result === undefined) {
        return reply.code(409).send({ error: 'You already sent this meetup request today' });
      }
      return reply.code(201).send({ request: result });
    },
  );

  app.get('/meetup/requests', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = requestListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'type must be received or sent' });
    }
    const { eventDate } = getMeetupTime();
    const ownerColumn =
      parsed.data.type === 'received' ? meetupRequests.toUser : meetupRequests.fromUser;
    const otherColumn =
      parsed.data.type === 'received' ? meetupRequests.fromUser : meetupRequests.toUser;
    const items = await app.db
      .select({
        request: meetupRequests,
        otherUser: {
          id: users.id,
          nickname: profiles.nickname,
          avatarIndex: users.avatarIndex,
        },
      })
      .from(meetupRequests)
      .innerJoin(users, eq(users.id, otherColumn))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(meetupRequests.eventDate, eventDate),
          eq(ownerColumn, request.user.sub),
        ),
      )
      .orderBy(desc(meetupRequests.createdAt));
    return reply.send(items);
  });

  for (const status of ['accepted', 'declined'] as const) {
    app.post<{ Params: { id: string } }>(
      `/meetup/requests/:id/${status}`,
      { preHandler: app.authenticate },
      async (request, reply) => {
        const requestId = z.string().uuid().safeParse(request.params.id);
        if (!requestId.success) {
          return reply.code(400).send({ error: 'Invalid meetup request id' });
        }
        const updated = await app.db.transaction(async (tx) => {
          const [pending] = await tx
            .select()
            .from(meetupRequests)
            .where(
              and(
                eq(meetupRequests.id, requestId.data),
                eq(meetupRequests.eventDate, getMeetupTime().eventDate),
                eq(meetupRequests.toUser, request.user.sub),
                eq(meetupRequests.status, 'pending'),
              ),
            )
            .limit(1)
            .for('update');
          if (pending === undefined) return undefined;

          let conversationId = pending.conversationId;
          if (status === 'accepted') {
            if (await areUsersBlocked(app.db, pending.fromUser, pending.toUser)) {
              return { blocked: true as const };
            }
            const userA =
              pending.fromUser < pending.toUser ? pending.fromUser : pending.toUser;
            const userB =
              pending.fromUser < pending.toUser ? pending.toUser : pending.fromUser;
            const [createdConversation] = await tx
              .insert(conversations)
              .values({ userA, userB })
              .onConflictDoNothing({
                target: [conversations.userA, conversations.userB],
              })
              .returning({ id: conversations.id });
            if (createdConversation !== undefined) {
              conversationId = createdConversation.id;
            } else {
              const [existingConversation] = await tx
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                  and(eq(conversations.userA, userA), eq(conversations.userB, userB)),
                )
                .limit(1);
              conversationId = existingConversation?.id ?? null;
            }
          }
          const [result] = await tx
            .update(meetupRequests)
            .set({ status, conversationId })
            .where(eq(meetupRequests.id, pending.id))
            .returning({ id: meetupRequests.id });
          return result === undefined ? undefined : { blocked: false as const };
        });
        if (updated === undefined) {
          return reply.code(404).send({ error: 'Pending meetup request not found' });
        }
        if (updated.blocked) {
          return reply.code(403).send({ error: 'User is unavailable' });
        }
        return reply.send({ [status]: true });
      },
    );
  }
};

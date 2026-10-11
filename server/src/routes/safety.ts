import { and, countDistinct, eq, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  blocks,
  conversationMutes,
  conversations,
  profiles,
  reports,
  users,
} from '../schema/index.js';
import { getConversationForUser } from '../services/conversation-access.js';
import { userRoomName } from '../sockets/user-room.js';

const reportSchema = z.object({
  userId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(80),
  details: z.string().trim().max(2000).optional(),
});
const muteSchema = z.object({ muted: z.boolean() });

export const safetyRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { userId: string } }>(
    '/blocks/:userId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const blockedId = z.string().uuid().safeParse(request.params.userId);
      if (!blockedId.success || blockedId.data === request.user.sub) {
        return reply.code(400).send({ error: 'Invalid user id' });
      }
      const [user] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, blockedId.data), eq(users.isActive, true)))
        .limit(1);
      if (user === undefined) {
        return reply.code(404).send({ error: 'User not found' });
      }

      await app.db
        .insert(blocks)
        .values({ blockerId: request.user.sub, blockedId: blockedId.data })
        .onConflictDoNothing();

      const pairConversations = await app.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          or(
            and(
              eq(conversations.userA, request.user.sub),
              eq(conversations.userB, blockedId.data),
            ),
            and(
              eq(conversations.userA, blockedId.data),
              eq(conversations.userB, request.user.sub),
            ),
          ),
        );
      for (const conversation of pairConversations) {
        const room = `conversation:${conversation.id}`;
        app.sockets.to(room).emit('chat:closed', { conversationId: conversation.id });
        await app.sockets.in(room).socketsLeave(room);
      }
      app.sockets
        .to(userRoomName(blockedId.data))
        .emit('user:blocked', { userId: request.user.sub });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { userId: string } }>(
    '/blocks/:userId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const blockedId = z.string().uuid().safeParse(request.params.userId);
      if (!blockedId.success) {
        return reply.code(400).send({ error: 'Invalid user id' });
      }
      await app.db
        .delete(blocks)
        .where(
          and(
            eq(blocks.blockerId, request.user.sub),
            eq(blocks.blockedId, blockedId.data),
          ),
        );
      app.sockets
        .to(userRoomName(blockedId.data))
        .emit('user:unblocked', { userId: request.user.sub });
      return reply.code(204).send();
    },
  );

  app.get('/blocks', { preHandler: app.authenticate }, async (request) => {
    return app.db
      .select({
        id: users.id,
        nickname: profiles.nickname,
        gender: users.gender,
        avatarIndex: users.avatarIndex,
        blockedAt: blocks.createdAt,
      })
      .from(blocks)
      .innerJoin(users, eq(blocks.blockedId, users.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(blocks.blockerId, request.user.sub))
      .orderBy(blocks.createdAt);
  });

  app.post('/reports', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = reportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid report', details: parsed.error.issues });
    }
    if (parsed.data.userId === request.user.sub) {
      return reply.code(400).send({ error: 'Cannot report yourself' });
    }
    const [reportedUser] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .limit(1);
    if (reportedUser === undefined) {
      return reply.code(404).send({ error: 'User not found' });
    }
    if (parsed.data.conversationId !== undefined) {
      const conversation = await getConversationForUser(
        app.db,
        parsed.data.conversationId,
        request.user.sub,
      );
      if (
        conversation === undefined ||
        (conversation.userA !== parsed.data.userId &&
          conversation.userB !== parsed.data.userId)
      ) {
        return reply.code(400).send({ error: 'Conversation does not match reported user' });
      }
    }

    await app.db.insert(reports).values({
      reporterId: request.user.sub,
      reportedId: parsed.data.userId,
      conversationId: parsed.data.conversationId,
      reason: parsed.data.reason,
      details: parsed.data.details,
    });

    const [reportCount] = await app.db
      .select({ total: countDistinct(reports.reporterId) })
      .from(reports)
      .where(eq(reports.reportedId, parsed.data.userId));
    if ((reportCount?.total ?? 0) >= 3) {
      await app.db
        .update(users)
        .set({ isFlagged: true })
        .where(eq(users.id, parsed.data.userId));
    }
    return reply.code(201).send({ submitted: true });
  });

  app.patch<{ Params: { id: string } }>(
    '/conversations/:id/mute',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const conversationId = z.string().uuid().safeParse(request.params.id);
      const parsed = muteSchema.safeParse(request.body);
      if (!conversationId.success || !parsed.success) {
        return reply.code(400).send({ error: 'Invalid mute request' });
      }
      const conversation = await getConversationForUser(
        app.db,
        conversationId.data,
        request.user.sub,
      );
      if (conversation === undefined) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      if (parsed.data.muted) {
        await app.db
          .insert(conversationMutes)
          .values({
            conversationId: conversation.id,
            userId: request.user.sub,
          })
          .onConflictDoNothing();
      } else {
        await app.db
          .delete(conversationMutes)
          .where(
            and(
              eq(conversationMutes.conversationId, conversation.id),
              eq(conversationMutes.userId, request.user.sub),
            ),
          );
      }
      return reply.send({ muted: parsed.data.muted });
    },
  );
};

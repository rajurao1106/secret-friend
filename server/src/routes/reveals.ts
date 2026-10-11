import { and, count, desc, eq, gte, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  conversations,
  friendRequests,
  messages,
  profiles,
  reveals,
  users,
} from '../schema/index.js';
import { areUsersBlocked, getConversationForUser } from '../services/conversation-access.js';
import { userRoomName } from '../sockets/user-room.js';

const cooldownMs = 24 * 60 * 60 * 1000;
const revealBodySchema = z.object({}).strict();
const requestListSchema = z.object({
  type: z.enum(['received', 'sent']).default('received'),
});

export const revealRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    '/conversations/:id/reveal-request',
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!revealBodySchema.safeParse(request.body ?? {}).success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }
      const conversationId = z.string().uuid().safeParse(request.params.id);
      if (!conversationId.success) {
        return reply.code(400).send({ error: 'Invalid conversation id' });
      }

      const conversation = await getConversationForUser(
        app.db,
        conversationId.data,
        request.user.sub,
      );
      if (conversation === undefined) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      const otherUserId =
        conversation.userA === request.user.sub
          ? conversation.userB
          : conversation.userA;
      if (await areUsersBlocked(app.db, request.user.sub, otherUserId)) {
        return reply.code(403).send({ error: 'Conversation is unavailable' });
      }

      const [existingReveal] = await app.db
        .select({ id: reveals.id })
        .from(reveals)
        .where(
          or(
            and(
              eq(reveals.userA, request.user.sub),
              eq(reveals.userB, otherUserId),
            ),
            and(
              eq(reveals.userA, otherUserId),
              eq(reveals.userB, request.user.sub),
            ),
          ),
        )
        .limit(1);
      if (existingReveal !== undefined) {
        return reply.code(409).send({ error: 'Friend is already revealed' });
      }

      const [sentByRequester] = await app.db
        .select({ total: count() })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.senderId, request.user.sub),
            eq(messages.isSystem, false),
          ),
        );
      const [sentByOtherUser] = await app.db
        .select({ total: count() })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.senderId, otherUserId),
            eq(messages.isSystem, false),
          ),
        );
      if (
        (sentByRequester?.total ?? 0) < 5 ||
        (sentByOtherUser?.total ?? 0) < 5
      ) {
        return reply.code(403).send({
          error: 'Both users must send at least five messages before revealing',
        });
      }

      const [cooldownRequest] = await app.db
        .select({ id: friendRequests.id })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.fromUser, request.user.sub),
            eq(friendRequests.toUser, otherUserId),
            eq(friendRequests.status, 'rejected'),
            gte(friendRequests.createdAt, new Date(Date.now() - cooldownMs)),
          ),
        )
        .limit(1);
      if (cooldownRequest !== undefined) {
        return reply.code(429).send({
          error: 'Wait 24 hours before sending another reveal request',
        });
      }

      const result = await app.db.transaction(async (tx) => {
        const [pending] = await tx
          .select({ id: friendRequests.id })
          .from(friendRequests)
          .where(
            and(
              eq(friendRequests.conversationId, conversation.id),
              eq(friendRequests.status, 'pending'),
            ),
          )
          .limit(1);
        if (pending !== undefined) {
          return undefined;
        }

        const [created] = await tx
          .insert(friendRequests)
          .values({
            fromUser: request.user.sub,
            toUser: otherUserId,
            conversationId: conversation.id,
          })
          .returning();
        if (created === undefined) {
          throw new Error('Failed to create reveal request');
        }
        const [systemMessage] = await tx
          .insert(messages)
          .values({
            conversationId: conversation.id,
            senderId: request.user.sub,
            type: 'text',
            body: 'Reveal friend request sent',
            isSystem: true,
          })
          .returning();
        if (systemMessage === undefined) {
          throw new Error('Failed to create reveal system message');
        }
        return { created, systemMessage };
      });

      if (result === undefined) {
        return reply.code(409).send({ error: 'A reveal request is already pending' });
      }

      const event = {
        request: result.created,
        conversationId: conversation.id,
      };
      app.sockets
        .to(userRoomName(otherUserId))
        .emit('reveal:requested', event);
      app.sockets
        .to(userRoomName(request.user.sub))
        .emit('message:new', { ...result.systemMessage, warning: false });
      app.sockets
        .to(userRoomName(otherUserId))
        .emit('message:new', { ...result.systemMessage, warning: false });
      return reply.code(201).send(result.created);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/friend-requests/:id/accept',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const requestId = z.string().uuid().safeParse(request.params.id);
      if (!requestId.success) {
        return reply.code(400).send({ error: 'Invalid request id' });
      }

      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(friendRequests)
          .where(
            and(
              eq(friendRequests.id, requestId.data),
              eq(friendRequests.toUser, request.user.sub),
              eq(friendRequests.status, 'pending'),
            ),
          )
          .limit(1)
          .for('update');
        if (row === undefined) {
          return undefined;
        }
        const [accepted] = await tx
          .update(friendRequests)
          .set({ status: 'accepted' })
          .where(eq(friendRequests.id, row.id))
          .returning();
        await tx
          .insert(reveals)
          .values({
            userA: row.fromUser < row.toUser ? row.fromUser : row.toUser,
            userB: row.fromUser < row.toUser ? row.toUser : row.fromUser,
          })
          .onConflictDoNothing();
        return { accepted, fromUser: row.fromUser, conversationId: row.conversationId };
      });

      if (result === undefined || result.accepted === undefined) {
        return reply.code(404).send({ error: 'Pending friend request not found' });
      }

      const event = {
        friendRequestId: result.accepted.id,
        conversationId: result.conversationId,
      };
      app.sockets.to(userRoomName(result.fromUser)).emit('reveal:unlocked', event);
      app.sockets
        .to(userRoomName(request.user.sub))
        .emit('reveal:unlocked', event);
      return reply.send({ accepted: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/friend-requests/:id/reject',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const requestId = z.string().uuid().safeParse(request.params.id);
      if (!requestId.success) {
        return reply.code(400).send({ error: 'Invalid request id' });
      }
      const [rejected] = await app.db
        .update(friendRequests)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(friendRequests.id, requestId.data),
            eq(friendRequests.toUser, request.user.sub),
            eq(friendRequests.status, 'pending'),
          ),
        )
        .returning({ id: friendRequests.id, fromUser: friendRequests.fromUser });
      if (rejected === undefined) {
        return reply.code(404).send({ error: 'Pending friend request not found' });
      }
      app.sockets
        .to(userRoomName(rejected.fromUser))
        .emit('reveal:rejected', { friendRequestId: rejected.id });
      return reply.send({ rejected: true });
    },
  );

  app.get('/friend-requests', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = requestListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'type must be received or sent' });
    }

    const ownerColumn =
      parsed.data.type === 'received'
        ? friendRequests.toUser
        : friendRequests.fromUser;
    const otherColumn =
      parsed.data.type === 'received'
        ? friendRequests.fromUser
        : friendRequests.toUser;
    const rows = await app.db
      .select({
        request: friendRequests,
        otherUser: {
          id: users.id,
          gender: users.gender,
          avatarIndex: users.avatarIndex,
          nickname: profiles.nickname,
        },
      })
      .from(friendRequests)
      .innerJoin(users, eq(otherColumn, users.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(ownerColumn, request.user.sub))
      .orderBy(desc(friendRequests.createdAt));
    return reply.send(rows);
  });

  app.delete<{ Params: { userId: string } }>(
    '/friends/:userId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const otherUserId = z.string().uuid().safeParse(request.params.userId);
      if (!otherUserId.success) {
        return reply.code(400).send({ error: 'Invalid user id' });
      }
      const [removed] = await app.db
        .delete(reveals)
        .where(
          or(
            and(
              eq(reveals.userA, request.user.sub),
              eq(reveals.userB, otherUserId.data),
            ),
            and(
              eq(reveals.userA, otherUserId.data),
              eq(reveals.userB, request.user.sub),
            ),
          ),
        )
        .returning({ id: reveals.id });
      if (removed === undefined) {
        return reply.code(404).send({ error: 'Friend not found' });
      }

      const [conversation] = await app.db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          or(
            and(
              eq(conversations.userA, request.user.sub),
              eq(conversations.userB, otherUserId.data),
            ),
            and(
              eq(conversations.userA, otherUserId.data),
              eq(conversations.userB, request.user.sub),
            ),
          ),
        )
        .limit(1);
      const event = { userId: request.user.sub };
      app.sockets
        .to(userRoomName(otherUserId.data))
        .emit('reveal:locked', event);
      app.sockets.to(userRoomName(request.user.sub)).emit('reveal:locked', event);
      if (conversation !== undefined) {
        app.sockets
          .in(`conversation:${conversation.id}`)
          .socketsLeave(`conversation:${conversation.id}`);
      }
      return reply.code(204).send();
    },
  );
};

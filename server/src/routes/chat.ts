import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lt,
  notInArray,
  or,
} from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  blocks,
  conversations,
  messages,
  profiles,
  users,
} from '../schema/index.js';
import { areUsersBlocked, getConversationForUser } from '../services/conversation-access.js';
import { hasReveal } from '../services/reveal-access.js';

const conversationSchema = z.object({ otherUserId: z.string().uuid() });
const listQuerySchema = z.object({
  cursor: z.string().optional(),
});
const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
const pageSize = 30;

function parseCursor(cursor: string | undefined) {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    const parsed = cursorSchema.safeParse(decoded);
    return parsed.success
      ? { createdAt: new Date(parsed.data.createdAt), id: parsed.data.id }
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
    'base64url',
  );
}

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get('/users', { preHandler: app.authenticate }, async (request, reply) => {
    const parsedQuery = listQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({ error: 'Invalid cursor' });
    }
    const cursor = parseCursor(parsedQuery.data.cursor);
    if (cursor === null) {
      return reply.code(400).send({ error: 'Invalid cursor' });
    }

    const blockedUsers = await app.db
      .select({ id: blocks.blockedId })
      .from(blocks)
      .where(eq(blocks.blockerId, request.user.sub));
    const blockedByUsers = await app.db
      .select({ id: blocks.blockerId })
      .from(blocks)
      .where(eq(blocks.blockedId, request.user.sub));
    const excludedIds = [
      request.user.sub,
      ...blockedUsers.map(({ id }) => id),
      ...blockedByUsers.map(({ id }) => id),
    ];
    const conditions = [eq(users.isActive, true), notInArray(users.id, excludedIds)];
    if (cursor !== undefined) {
      conditions.push(
        or(
          lt(users.createdAt, cursor.createdAt),
          and(eq(users.createdAt, cursor.createdAt), lt(users.id, cursor.id)),
        )!,
      );
    }

    const candidates = await app.db
      .select({
        id: users.id,
        gender: users.gender,
        avatarIndex: users.avatarIndex,
        createdAt: users.createdAt,
        nickname: profiles.nickname,
      })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(and(...conditions))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(pageSize + 1);
    const hasMore = candidates.length > pageSize;
    const page = candidates.slice(0, pageSize);
    const items = await Promise.all(
      page.map(async (candidate) => {
        const first = candidate.id < request.user.sub ? candidate.id : request.user.sub;
        const second = candidate.id < request.user.sub ? request.user.sub : candidate.id;
        const [conversation] = await app.db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.userA, first), eq(conversations.userB, second)))
          .limit(1);

        if (conversation === undefined) {
          return { ...candidate, lastMessage: null, unreadCount: 0 };
        }
        const [lastMessage] = await app.db
          .select({
            body: messages.body,
            type: messages.type,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(eq(messages.conversationId, conversation.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        const unread = await app.db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversation.id),
              eq(messages.senderId, candidate.id),
              inArray(messages.status, ['sent', 'delivered']),
            ),
          );

        return {
          ...candidate,
          lastMessage: lastMessage ?? null,
          unreadCount: unread.length,
        };
      }),
    );
    const last = page.at(-1);

    return reply.send({
      items,
      nextCursor:
        hasMore && last !== undefined ? encodeCursor(last.createdAt, last.id) : null,
    });
  });

  app.post('/conversations', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = conversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid conversation request' });
    }
    const otherUserId = parsed.data.otherUserId;
    if (otherUserId === request.user.sub) {
      return reply.code(400).send({ error: 'Cannot start a conversation with yourself' });
    }
    const [otherUser] = await app.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, otherUserId), eq(users.isActive, true)))
      .limit(1);
    if (otherUser === undefined) {
      return reply.code(404).send({ error: 'User not found' });
    }
    if (await areUsersBlocked(app.db, request.user.sub, otherUserId)) {
      return reply.code(403).send({ error: 'Conversation is unavailable' });
    }

    const userA = request.user.sub < otherUserId ? request.user.sub : otherUserId;
    const userB = request.user.sub < otherUserId ? otherUserId : request.user.sub;
    const [created] = await app.db
      .insert(conversations)
      .values({ userA, userB })
      .onConflictDoNothing({
        target: [conversations.userA, conversations.userB],
      })
      .returning();
    if (created !== undefined) {
      return reply.code(201).send(created);
    }

    const [existing] = await app.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userA, userA), eq(conversations.userB, userB)))
      .limit(1);
    if (existing === undefined) {
      throw new Error('Conversation creation failed');
    }
    return reply.send(existing);
  });

  app.get<{ Params: { id: string } }>(
    '/conversations/:id/messages',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const conversationId = z.string().uuid().safeParse(request.params.id);
      const query = historyQuerySchema.safeParse(request.query);
      if (!conversationId.success || !query.success) {
        return reply.code(400).send({ error: 'Invalid message history request' });
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

      const cursor = parseCursor(query.data.cursor);
      if (cursor === null) {
        return reply.code(400).send({ error: 'Invalid cursor' });
      }
      const revealed = await hasReveal(app.db, request.user.sub, otherUserId);
      const filters = [eq(messages.conversationId, conversation.id)];
      if (!revealed) {
        filters.push(eq(messages.type, 'text'));
      }
      if (cursor !== undefined) {
        filters.push(
          or(
            lt(messages.createdAt, cursor.createdAt),
            and(
              eq(messages.createdAt, cursor.createdAt),
              lt(messages.id, cursor.id),
            ),
          )!,
        );
      }
      const records = await app.db
        .select()
        .from(messages)
        .where(and(...filters))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(query.data.limit + 1);
      const hasMore = records.length > query.data.limit;
      const page = records.slice(0, query.data.limit).reverse();
      const last = page.at(0);

      return reply.send({
        items: page,
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(last.createdAt, last.id)
            : null,
      });
    },
  );
};

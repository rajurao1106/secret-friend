import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { media } from '../schema/media.js';
import { messages } from '../schema/messages.js';
import { userRoomName } from './user-room.js';
import { areUsersBlocked, getConversationForUser } from '../services/conversation-access.js';
import { hasReveal } from '../services/reveal-access.js';
import { containsPersonalInfo } from '../services/anonymity-warning.js';
import { MessageRateLimiter } from '../services/message-rate-limiter.js';
import { conversationMutes } from '../schema/conversation-mutes.js';

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['text', 'image', 'file']).default('text'),
  body: z.string().max(2000).optional(),
  mediaId: z.string().uuid().optional(),
});
const conversationIdSchema = z.object({ conversationId: z.string().uuid() });

function registerSafely(
  app: FastifyInstance,
  socket: Socket,
  event: string,
  errorEvent: string,
  handler: (payload: unknown) => Promise<void>,
): void {
  socket.on(event, (payload: unknown) => {
    void handler(payload).catch((error: unknown) => {
      app.log.error({ err: error, event }, 'Socket request failed');
      socket.emit(errorEvent, { error: 'Request failed' });
    });
  });
}

export function registerChatSocketHandlers(
  app: FastifyInstance,
  sockets: Server,
): void {
  const messageLimiter = new MessageRateLimiter();

  sockets.on('connection', (socket: Socket) => {
    registerSafely(app, socket, 'conversation:join', 'chat:error', async (payload) => {
      const parsed = conversationIdSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('chat:error', { error: 'Invalid conversation' });
        return;
      }
      const conversation = await getConversationForUser(
        app.db,
        parsed.data.conversationId,
        socket.data.userId,
      );
      if (conversation === undefined) {
        socket.emit('chat:error', { error: 'Conversation not found' });
        return;
      }
      const otherUserId =
        conversation.userA === socket.data.userId
          ? conversation.userB
          : conversation.userA;
      if (await areUsersBlocked(app.db, socket.data.userId, otherUserId)) {
        socket.emit('chat:error', { error: 'Conversation is unavailable' });
        return;
      }
      await socket.join(`conversation:${conversation.id}`);
    });

    registerSafely(app, socket, 'message:send', 'message:error', async (payload) => {
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('message:error', { error: 'Invalid message' });
        return;
      }
      const input = parsed.data;
      if (input.type === 'text' && (input.body === undefined || input.body.length === 0)) {
        socket.emit('message:error', { error: 'Text message cannot be empty' });
        return;
      }
      if (input.type !== 'text' && input.mediaId === undefined) {
        socket.emit('message:error', { error: 'Media is required' });
        return;
      }
      if (!messageLimiter.allow(socket.data.userId)) {
        socket.emit('message:error', { error: 'Message rate limit exceeded' });
        return;
      }

      const conversation = await getConversationForUser(
        app.db,
        input.conversationId,
        socket.data.userId,
      );
      if (conversation === undefined) {
        socket.emit('message:error', { error: 'Conversation not found' });
        return;
      }
      const recipientId =
        conversation.userA === socket.data.userId
          ? conversation.userB
          : conversation.userA;
      if (await areUsersBlocked(app.db, socket.data.userId, recipientId)) {
        socket.emit('message:error', { error: 'Conversation is unavailable' });
        return;
      }
      const revealed = await hasReveal(app.db, socket.data.userId, recipientId);
      if (!revealed && input.type !== 'text') {
        socket.emit('message:error', { error: 'Media requires a reveal' });
        return;
      }

      if (input.mediaId !== undefined) {
        const [ownedMedia] = await app.db
          .select({ id: media.id })
          .from(media)
          .where(
            and(
              eq(media.id, input.mediaId),
              eq(media.ownerId, socket.data.userId),
              eq(media.kind, 'chat'),
            ),
          )
          .limit(1);
        if (ownedMedia === undefined) {
          socket.emit('message:error', { error: 'Media is unavailable' });
          return;
        }
      }

      let [message] = await app.db
        .insert(messages)
        .values({
          conversationId: conversation.id,
          senderId: socket.data.userId,
          type: input.type,
          body: input.body,
          mediaId: input.mediaId,
        })
        .returning();
      if (message === undefined) {
        throw new Error('Failed to save message');
      }

      const recipientRoom = userRoomName(recipientId);
      const recipientSockets = await sockets.in(recipientRoom).fetchSockets();
      if (recipientSockets.length > 0) {
        const [deliveredMessage] = await app.db
          .update(messages)
          .set({ status: 'delivered' })
          .where(eq(messages.id, message.id))
          .returning();
        if (deliveredMessage !== undefined) {
          message = deliveredMessage;
        }
      }

      const warning = !revealed && containsPersonalInfo(input.body ?? '');
      sockets.to(recipientRoom).emit('message:new', { ...message, warning });
      socket.emit('message:sent', { ...message, warning });

      const [mute] = await app.db
        .select({ userId: conversationMutes.userId })
        .from(conversationMutes)
        .where(
          and(
            eq(conversationMutes.conversationId, conversation.id),
            eq(conversationMutes.userId, recipientId),
          ),
        )
        .limit(1);
      if (recipientSockets.length === 0 && mute === undefined) {
        await app.notificationService.push(recipientId, {
          title: 'New message',
          body: input.type === 'text' ? input.body ?? '' : 'You received a message',
          data: { conversationId: conversation.id },
        });
      }
    });

    registerSafely(app, socket, 'message:read', 'chat:error', async (payload) => {
      const parsed = conversationIdSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('chat:error', { error: 'Invalid conversation' });
        return;
      }
      const conversation = await getConversationForUser(
        app.db,
        parsed.data.conversationId,
        socket.data.userId,
      );
      if (conversation === undefined) {
        socket.emit('chat:error', { error: 'Conversation not found' });
        return;
      }
      const otherUserId =
        conversation.userA === socket.data.userId
          ? conversation.userB
          : conversation.userA;
      if (await areUsersBlocked(app.db, socket.data.userId, otherUserId)) {
        socket.emit('chat:error', { error: 'Conversation is unavailable' });
        return;
      }

      await app.db
        .update(messages)
        .set({ status: 'read' })
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            inArray(messages.senderId, [otherUserId]),
            sql`${messages.status} <> 'read'`,
          ),
        );
      sockets.to(userRoomName(otherUserId)).emit('message:read', {
        conversationId: conversation.id,
        readerId: socket.data.userId,
      });
    });

    for (const event of ['typing:start', 'typing:stop'] as const) {
      registerSafely(app, socket, event, 'chat:error', async (payload) => {
        const parsed = conversationIdSchema.safeParse(payload);
        if (!parsed.success) {
          return;
        }
        const conversation = await getConversationForUser(
          app.db,
          parsed.data.conversationId,
          socket.data.userId,
        );
        if (conversation === undefined) {
          return;
        }
        const otherUserId =
          conversation.userA === socket.data.userId
            ? conversation.userB
            : conversation.userA;
        if (await areUsersBlocked(app.db, socket.data.userId, otherUserId)) {
          return;
        }
        sockets.to(userRoomName(otherUserId)).emit(event, {
          conversationId: conversation.id,
          userId: socket.data.userId,
        });
      });
    }

    socket.on('disconnect', () => {
      sockets.emit('presence:update', {
        userId: socket.data.userId,
        online: false,
      });
    });

    sockets.emit('presence:update', { userId: socket.data.userId, online: true });
  });
}

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { messages } from '../schema/messages.js';
import { userRoomName } from './user-room.js';
import { areUsersBlocked, getConversationForUser } from '../services/conversation-access.js';
import { MessageRateLimiter } from '../services/message-rate-limiter.js';
import { conversationMutes } from '../schema/conversation-mutes.js';
import { createChatMessage } from '../services/chat-message.js';

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
      const result = await createChatMessage(
        app.db,
        socket.data.userId,
        payload,
        messageLimiter,
      );
      if (!result.success) {
        socket.emit('message:error', { error: result.error });
        return;
      }

      let { message } = result;
      const recipientRoom = userRoomName(result.recipientId);
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

      sockets.to(recipientRoom).emit('message:new', {
        ...message,
        warning: result.warning,
      });
      socket.emit('message:sent', { ...message, warning: result.warning });

      const [mute] = await app.db
        .select({ userId: conversationMutes.userId })
        .from(conversationMutes)
        .where(
          and(
            eq(conversationMutes.conversationId, message.conversationId),
            eq(conversationMutes.userId, result.recipientId),
          ),
        )
        .limit(1);
      if (recipientSockets.length === 0 && mute === undefined) {
        await app.notificationService.push(result.recipientId, {
          title: 'New message',
          body: message.type === 'text' ? message.body ?? '' : 'You received a message',
          data: { conversationId: message.conversationId },
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

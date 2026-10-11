import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../db/client.js';
import { media } from '../schema/media.js';
import { messages } from '../schema/messages.js';
import { areUsersBlocked, getConversationForUser } from './conversation-access.js';
import { hasReveal } from './reveal-access.js';
import { containsPersonalInfo } from './anonymity-warning.js';
import { MessageRateLimiter } from './message-rate-limiter.js';

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  type: z.enum(['text', 'image', 'file']).default('text'),
  body: z.string().max(2000).optional(),
  mediaId: z.string().uuid().optional(),
});

type SendMessageFailure = {
  success: false;
  statusCode: 400 | 403 | 404 | 429;
  error: string;
};

type SendMessageSuccess = {
  success: true;
  message: typeof messages.$inferSelect;
  recipientId: string;
  warning: boolean;
};

export async function createChatMessage(
  db: AppDatabase,
  senderId: string,
  payload: unknown,
  limiter: MessageRateLimiter,
): Promise<SendMessageFailure | SendMessageSuccess> {
  const parsed = sendMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, statusCode: 400, error: 'Invalid message' };
  }
  const input = parsed.data;
  if (input.type === 'text' && (input.body === undefined || input.body.length === 0)) {
    return {
      success: false,
      statusCode: 400,
      error: 'Text message cannot be empty',
    };
  }
  if (input.type !== 'text' && input.mediaId === undefined) {
    return { success: false, statusCode: 400, error: 'Media is required' };
  }
  if (!limiter.allow(senderId)) {
    return {
      success: false,
      statusCode: 429,
      error: 'Message rate limit exceeded',
    };
  }

  const conversation = await getConversationForUser(
    db,
    input.conversationId,
    senderId,
  );
  if (conversation === undefined) {
    return { success: false, statusCode: 404, error: 'Conversation not found' };
  }
  const recipientId =
    conversation.userA === senderId ? conversation.userB : conversation.userA;
  if (await areUsersBlocked(db, senderId, recipientId)) {
    return {
      success: false,
      statusCode: 403,
      error: 'Conversation is unavailable',
    };
  }

  const revealed = await hasReveal(db, senderId, recipientId);
  if (!revealed && input.type !== 'text') {
    return { success: false, statusCode: 403, error: 'Media requires a reveal' };
  }

  if (input.mediaId !== undefined) {
    const [ownedMedia] = await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          eq(media.id, input.mediaId),
          eq(media.ownerId, senderId),
          eq(media.kind, 'chat'),
        ),
      )
      .limit(1);
    if (ownedMedia === undefined) {
      return { success: false, statusCode: 403, error: 'Media is unavailable' };
    }
  }

  const [message] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      senderId,
      type: input.type,
      body: input.body,
      mediaId: input.mediaId,
    })
    .returning();
  if (message === undefined) {
    throw new Error('Failed to save message');
  }

  return {
    success: true,
    message,
    recipientId,
    warning: !revealed && containsPersonalInfo(input.body ?? ''),
  };
}

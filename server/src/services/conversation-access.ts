import { and, eq, or } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { blocks } from '../schema/blocks.js';
import { conversations } from '../schema/conversations.js';

export async function getConversationForUser(
  db: AppDatabase,
  conversationId: string,
  userId: string,
) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        or(eq(conversations.userA, userId), eq(conversations.userB, userId)),
      ),
    )
    .limit(1);

  return conversation;
}

export async function areUsersBlocked(
  db: AppDatabase,
  userA: string,
  userB: string,
): Promise<boolean> {
  const [block] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, userA), eq(blocks.blockedId, userB)),
        and(eq(blocks.blockerId, userB), eq(blocks.blockedId, userA)),
      ),
    )
    .limit(1);
  return block !== undefined;
}

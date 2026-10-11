import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { messageStatusEnum, messageTypeEnum } from './enums.js';
import { media } from './media.js';
import { users } from './users.js';

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: messageTypeEnum('type').default('text').notNull(),
    body: text('body'),
    isSystem: boolean('is_system').default(false).notNull(),
    mediaId: uuid('media_id').references(() => media.id, { onDelete: 'set null' }),
    status: messageStatusEnum('status').default('sent').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt.desc(),
    ),
  ],
);

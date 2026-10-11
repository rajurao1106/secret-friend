import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';

export const conversationMutes = pgTable(
  'conversation_mutes',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.userId] })],
);

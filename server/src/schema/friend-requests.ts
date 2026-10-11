import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { friendRequestStatusEnum } from './enums.js';
import { users } from './users.js';

export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fromUser: uuid('from_user')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUser: uuid('to_user')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    status: friendRequestStatusEnum('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('friend_requests_to_status_idx').on(table.toUser, table.status),
  ],
);

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from './conversations.js';
import { users } from './users.js';

export const meetupParticipations = pgTable(
  'meetup_participations',
  {
    eventDate: date('event_date').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interested: boolean('interested').default(true).notNull(),
    quickReply: boolean('quick_reply').default(false).notNull(),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('meetup_participations_event_user_idx').on(
      table.eventDate,
      table.userId,
    ),
    index('meetup_participations_event_interested_idx').on(
      table.eventDate,
      table.interested,
    ),
  ],
);

export const userPresence = pgTable('user_presence', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const meetupRequests = pgTable(
  'meetup_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventDate: date('event_date').notNull(),
    fromUser: uuid('from_user')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    toUser: uuid('to_user')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' }),
    status: text('status').default('pending').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check('meetup_requests_distinct_users', sql`${table.fromUser} <> ${table.toUser}`),
    check(
      'meetup_requests_status_valid',
      sql`${table.status} in ('pending', 'accepted', 'declined')`,
    ),
    uniqueIndex('meetup_requests_event_pair_idx').on(
      table.eventDate,
      table.fromUser,
      table.toUser,
    ),
    index('meetup_requests_to_status_idx').on(table.toUser, table.status),
    index('meetup_requests_from_event_idx').on(table.fromUser, table.eventDate),
  ],
);

import { integer, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const kundaliMatches = pgTable(
  'kundali_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userA: uuid('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: uuid('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('kundali_matches_pair_idx').on(table.userA, table.userB)],
);

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';
import { genderEnum } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mobile: text('mobile').notNull().unique(),
    gender: genderEnum('gender').default('other').notNull(),
    avatarIndex: integer('avatar_index').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    isFlagged: boolean('is_flagged').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('users_avatar_index_range', sql`${table.avatarIndex} between 0 and 7`),
    index('users_created_at_idx').on(table.createdAt.desc()),
  ],
);

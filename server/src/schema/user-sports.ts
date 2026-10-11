import { pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { sports } from './sports.js';
import { users } from './users.js';

export const userSports = pgTable(
  'user_sports',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sportId: uuid('sport_id')
      .notNull()
      .references(() => sports.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.sportId] })],
);

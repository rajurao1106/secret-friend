import { pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { hobbies } from './hobbies.js';
import { users } from './users.js';

export const userHobbies = pgTable(
  'user_hobbies',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hobbyId: uuid('hobby_id')
      .notNull()
      .references(() => hobbies.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.hobbyId] })],
);

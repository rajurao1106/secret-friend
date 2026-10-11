import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const hobbies = pgTable('hobbies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
});

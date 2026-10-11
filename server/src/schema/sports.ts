import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const sports = pgTable('sports', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
});

import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { mediaKindEnum } from './enums.js';
import { users } from './users.js';

export const media = pgTable('media', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  mime: text('mime').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  kind: mediaKindEnum('kind').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

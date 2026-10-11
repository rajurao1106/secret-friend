import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    mobile: text('mobile').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('otp_codes_mobile_created_idx').on(table.mobile, table.createdAt.desc())],
);

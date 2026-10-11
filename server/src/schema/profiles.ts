import { boolean, date, pgTable, real, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  nickname: text('nickname'),
  dob: date('dob', { mode: 'string' }),
  birthTime: time('birth_time'),
  birthPlace: text('birth_place'),
  birthLat: real('birth_lat'),
  birthLng: real('birth_lng'),
  birthTz: text('birth_tz'),
  bio: text('bio'),
  profilePhotoKey: text('profile_photo_key'),
  shareMobile: boolean('share_mobile').default(false).notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }),
});

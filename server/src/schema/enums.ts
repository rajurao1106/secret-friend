import { pgEnum } from 'drizzle-orm/pg-core';

export const genderEnum = pgEnum('gender', ['male', 'female', 'other']);
export const messageTypeEnum = pgEnum('message_type', ['text', 'image', 'file']);
export const messageStatusEnum = pgEnum('message_status', [
  'sent',
  'delivered',
  'read',
]);
export const friendRequestStatusEnum = pgEnum('friend_request_status', [
  'pending',
  'accepted',
  'rejected',
]);
export const mediaKindEnum = pgEnum('media_kind', ['gallery', 'chat', 'profile']);

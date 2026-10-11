import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  blocks,
  conversations,
  friendRequests,
  kundaliMatches,
  media,
  messages,
  mediaUploads,
  otpCodes,
  profiles,
  refreshTokens,
  reports,
  reveals,
  userHobbies,
  userSports,
  users,
} from '../schema/index.js';
import { userRoomName } from '../sockets/user-room.js';

export const meRoutes: FastifyPluginAsync = async (app) => {
  app.delete(
    '/me',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.user.sub;
      const [ownedMedia, pendingMedia] = await Promise.all([
        app.db.select({ key: media.key }).from(media).where(eq(media.ownerId, userId)),
        app.db
          .select({ key: mediaUploads.key })
          .from(mediaUploads)
          .where(eq(mediaUploads.ownerId, userId)),
      ]);
      if (
        ownedMedia.length + pendingMedia.length > 0 &&
        !app.mediaStorage.configured
      ) {
        return reply.code(503).send({
          error: 'Media storage is required to delete uploaded personal data',
        });
      }
      for (const file of [...ownedMedia, ...pendingMedia]) {
        await app.mediaStorage.delete(file.key);
      }

      await app.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ mobile: users.mobile })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.isActive, true)))
          .limit(1);

        if (user === undefined) {
          return;
        }

        const userConversations = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(or(eq(conversations.userA, userId), eq(conversations.userB, userId)));
        const conversationIds = userConversations.map(({ id }) => id);

        if (conversationIds.length > 0) {
          await tx
            .delete(messages)
            .where(inArray(messages.conversationId, conversationIds));
        }
        await tx.delete(messages).where(eq(messages.senderId, userId));
        await tx.delete(friendRequests).where(
          or(eq(friendRequests.fromUser, userId), eq(friendRequests.toUser, userId)),
        );
        await tx.delete(reveals).where(
          or(eq(reveals.userA, userId), eq(reveals.userB, userId)),
        );
        await tx.delete(kundaliMatches).where(
          or(eq(kundaliMatches.userA, userId), eq(kundaliMatches.userB, userId)),
        );
        await tx.delete(media).where(eq(media.ownerId, userId));
        await tx.delete(mediaUploads).where(eq(mediaUploads.ownerId, userId));
        await tx.delete(blocks).where(
          or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)),
        );
        await tx.delete(reports).where(
          or(eq(reports.reporterId, userId), eq(reports.reportedId, userId)),
        );
        await tx.delete(userHobbies).where(eq(userHobbies.userId, userId));
        await tx.delete(userSports).where(eq(userSports.userId, userId));
        await tx.delete(profiles).where(eq(profiles.userId, userId));
        await tx.delete(otpCodes).where(eq(otpCodes.mobile, user.mobile));
        await tx.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
        if (conversationIds.length > 0) {
          await tx
            .delete(conversations)
            .where(inArray(conversations.id, conversationIds));
        }
        await tx
          .update(users)
          .set({
            mobile: `deleted:${userId}`,
            gender: 'other',
            avatarIndex: 0,
            isActive: false,
            isFlagged: false,
            deletedAt: new Date(),
          })
          .where(eq(users.id, userId));
      });

      app.sockets.in(userRoomName(userId)).disconnectSockets(true);
      return reply.code(204).send();
    },
  );
};

import { randomUUID } from 'node:crypto';
import { and, count, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  conversations,
  media,
  mediaUploads,
  messages,
  profiles,
  users,
} from '../schema/index.js';
import { areUsersBlocked } from '../services/conversation-access.js';
import type { MediaStorage } from '../services/media-storage.js';
import type { ModerationService } from '../services/moderation.js';
import { hasReveal } from '../services/reveal-access.js';

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const fileTypes = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);
const imageMaxSize = 5 * 1024 * 1024;
const fileMaxSize = 20 * 1024 * 1024;
const uploadLifetimeMs = 15 * 60 * 1000;
const signedUrlSeconds = 5 * 60;

const presignSchema = z.object({
  kind: z.enum(['gallery', 'chat', 'profile']),
  mime: z.string().min(1).max(150),
  size: z.number().int().positive(),
  conversationId: z.string().uuid().optional(),
});
const confirmSchema = z.object({ uploadId: z.string().uuid() });
const mediaIdSchema = z.object({ id: z.string().uuid() });

export interface MediaRouteOptions {
  readonly storage: MediaStorage;
  readonly moderation: ModerationService;
}

function validMediaRequest(input: z.infer<typeof presignSchema>): boolean {
  if (input.kind === 'gallery' || input.kind === 'profile') {
    return imageTypes.has(input.mime) && input.size <= imageMaxSize;
  }
  if (imageTypes.has(input.mime)) {
    return input.size <= imageMaxSize;
  }
  return fileTypes.has(input.mime) && input.size <= fileMaxSize;
}

export const mediaRoutes: FastifyPluginAsync<MediaRouteOptions> = async (
  app,
  options,
) => {
  app.post('/media/presign', { preHandler: app.authenticate }, async (request, reply) => {
    if (!options.storage.configured) {
      return reply.code(503).send({ error: 'Media storage is not configured' });
    }
    const parsed = presignSchema.safeParse(request.body);
    if (!parsed.success || !validMediaRequest(parsed.data)) {
      return reply.code(400).send({ error: 'Unsupported media type or file size' });
    }
    const input = parsed.data;
    if (input.kind === 'chat') {
      if (input.conversationId === undefined) {
        return reply.code(400).send({ error: 'conversationId is required for chat media' });
      }
      const [conversation] = await app.db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, input.conversationId),
            eq(conversations.userA, request.user.sub),
          ),
        )
        .limit(1);
      const [reverseConversation] =
        conversation === undefined
          ? await app.db
              .select()
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, input.conversationId),
                  eq(conversations.userB, request.user.sub),
                ),
              )
              .limit(1)
          : [conversation];
      const chat = conversation ?? reverseConversation;
      if (chat === undefined) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      const otherUserId =
        chat.userA === request.user.sub ? chat.userB : chat.userA;
      if (
        (await areUsersBlocked(app.db, request.user.sub, otherUserId)) ||
        !(await hasReveal(app.db, request.user.sub, otherUserId))
      ) {
        return reply.code(403).send({ error: 'Chat media requires an active reveal' });
      }
    }

    const uploadId = randomUUID();
    const key = options.storage.keyForUpload(
      request.user.sub,
      input.kind,
      randomUUID(),
      input.mime,
    );
    if (input.kind === 'gallery') {
      const reserved = await app.db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, request.user.sub))
          .for('update');
        const [stored] = await tx
          .select({ total: count() })
          .from(media)
          .where(and(eq(media.ownerId, request.user.sub), eq(media.kind, 'gallery')));
        const [pending] = await tx
          .select({ total: count() })
          .from(mediaUploads)
          .where(
            and(
              eq(mediaUploads.ownerId, request.user.sub),
              eq(mediaUploads.kind, 'gallery'),
              gt(mediaUploads.expiresAt, new Date()),
            ),
          );
        if ((stored?.total ?? 0) + (pending?.total ?? 0) >= 9) {
          return false;
        }
        await tx.insert(mediaUploads).values({
          id: uploadId,
          ownerId: request.user.sub,
          key,
          mime: input.mime,
          size: input.size,
          kind: input.kind,
          expiresAt: new Date(Date.now() + uploadLifetimeMs),
        });
        return true;
      });
      if (!reserved) {
        return reply.code(409).send({ error: 'Gallery is limited to nine images' });
      }
    } else {
      await app.db.insert(mediaUploads).values({
        id: uploadId,
        ownerId: request.user.sub,
        key,
        mime: input.mime,
        size: input.size,
        kind: input.kind,
        conversationId: input.conversationId,
        expiresAt: new Date(Date.now() + uploadLifetimeMs),
      });
    }

    try {
      const upload = await options.storage.presignUpload(key, 900);
      return reply.send({
        uploadId,
        ...upload,
      });
    } catch (error: unknown) {
      await app.db.delete(mediaUploads).where(eq(mediaUploads.id, uploadId));
      throw error;
    }
  });

  app.post('/media/confirm', { preHandler: app.authenticate }, async (request, reply) => {
    if (!options.storage.configured) {
      return reply.code(503).send({ error: 'Media storage is not configured' });
    }
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid upload id' });
    }
    const [upload] = await app.db
      .select()
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.id, parsed.data.uploadId),
          eq(mediaUploads.ownerId, request.user.sub),
          gt(mediaUploads.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (upload === undefined) {
      return reply.code(404).send({ error: 'Upload reservation expired or not found' });
    }
    if (upload.kind === 'chat') {
      if (upload.conversationId === null) {
        throw new Error('Chat upload reservation is missing its conversation');
      }
      const [chat] = await app.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, upload.conversationId))
        .limit(1);
      if (
        chat === undefined ||
        (chat.userA !== request.user.sub && chat.userB !== request.user.sub)
      ) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }
      const otherUserId = chat.userA === request.user.sub ? chat.userB : chat.userA;
      if (
        (await areUsersBlocked(app.db, request.user.sub, otherUserId)) ||
        !(await hasReveal(app.db, request.user.sub, otherUserId))
      ) {
        return reply.code(403).send({ error: 'Chat media requires an active reveal' });
      }
    }

    const uploaded = await options.storage.head(upload.key);
    if (uploaded.size !== upload.size || uploaded.mime !== upload.mime) {
      await options.storage.delete(upload.key);
      await app.db.delete(mediaUploads).where(eq(mediaUploads.id, upload.id));
      return reply.code(400).send({ error: 'Uploaded media did not match its reservation' });
    }
    if (upload.mime.startsWith('image/')) {
      await options.moderation.inspectImage(upload.key, upload.mime);
    }

    const inserted = await app.db.transaction(async (tx) => {
      if (upload.kind === 'gallery') {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, request.user.sub))
          .for('update');
        const [stored] = await tx
          .select({ total: count() })
          .from(media)
          .where(and(eq(media.ownerId, request.user.sub), eq(media.kind, 'gallery')));
        if ((stored?.total ?? 0) >= 9) {
          return undefined;
        }
      }

      const [record] = await tx
        .insert(media)
        .values({
          ownerId: request.user.sub,
          key: upload.key,
          mime: upload.mime,
          size: upload.size,
          kind: upload.kind,
        })
        .returning();
      if (record === undefined) {
        throw new Error('Failed to confirm media upload');
      }
      if (upload.kind === 'profile') {
        await tx
          .insert(profiles)
          .values({
            userId: request.user.sub,
            profilePhotoKey: upload.key,
          })
          .onConflictDoUpdate({
            target: profiles.userId,
            set: { profilePhotoKey: upload.key },
          });
      }
      await tx.delete(mediaUploads).where(eq(mediaUploads.id, upload.id));
      return record;
    });
    if (inserted === undefined) {
      await options.storage.delete(upload.key);
      await app.db.delete(mediaUploads).where(eq(mediaUploads.id, upload.id));
      return reply.code(409).send({ error: 'Gallery is limited to nine images' });
    }
    return reply.code(201).send(inserted);
  });

  app.get<{ Params: { id: string } }>(
    '/media/:id/url',
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!options.storage.configured) {
        return reply.code(503).send({ error: 'Media storage is not configured' });
      }
      const parsed = mediaIdSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid media id' });
      }
      const [record] = await app.db
        .select()
        .from(media)
        .where(eq(media.id, parsed.data.id))
        .limit(1);
      if (record === undefined) {
        return reply.code(404).send({ error: 'Media not found' });
      }
      if (record.ownerId !== request.user.sub) {
        if (record.kind !== 'chat') {
          return reply.code(404).send({ error: 'Media not found' });
        }
        const [message] = await app.db
          .select({
            conversationId: messages.conversationId,
            userA: conversations.userA,
            userB: conversations.userB,
          })
          .from(messages)
          .innerJoin(conversations, eq(messages.conversationId, conversations.id))
          .where(eq(messages.mediaId, record.id))
          .limit(1);
        if (
          message === undefined ||
          (message.userA !== request.user.sub && message.userB !== request.user.sub)
        ) {
          return reply.code(404).send({ error: 'Media not found' });
        }
        const otherUserId =
          message.userA === request.user.sub ? message.userB : message.userA;
        if (
          (await areUsersBlocked(app.db, request.user.sub, otherUserId)) ||
          !(await hasReveal(app.db, request.user.sub, otherUserId))
        ) {
          return reply.code(404).send({ error: 'Media not found' });
        }
      }
      return reply.send({
        url: await options.storage.presignDownload(record.key, signedUrlSeconds),
        expiresInSeconds: signedUrlSeconds,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/media/:id',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = mediaIdSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid media id' });
      }
      const [record] = await app.db
        .select()
        .from(media)
        .where(
          and(eq(media.id, parsed.data.id), eq(media.ownerId, request.user.sub)),
        )
        .limit(1);
      if (record === undefined) {
        return reply.code(404).send({ error: 'Media not found' });
      }
      if (!options.storage.configured) {
        return reply.code(503).send({ error: 'Media storage is not configured' });
      }
      await options.storage.delete(record.key);
      await app.db.transaction(async (tx) => {
        if (record.kind === 'profile') {
          await tx
            .update(profiles)
            .set({ profilePhotoKey: null })
            .where(
              and(
                eq(profiles.userId, request.user.sub),
                eq(profiles.profilePhotoKey, record.key),
              ),
            );
        }
        await tx.delete(media).where(eq(media.id, record.id));
      });
      return reply.code(204).send();
    },
  );
};

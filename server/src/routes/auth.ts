import { randomInt } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import {
  refreshTokens,
  users,
} from '../schema/index.js';
import { OtpRateLimiter } from '../services/otp-rate-limiter.js';
import {
  FirebaseAdminConfigurationError,
  FirebaseTokenInvalidError,
  type FirebaseTokenVerifier,
} from '../services/firebase-auth.js';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../utils/refresh-token.js';

const mobilePattern = /^(?:(?:\+91|91))?[6-9]\d{9}$/;
const mobileSchema = z.string().trim().regex(mobilePattern).transform((value) => {
  const digits = value.replace(/^\+?91/, '');
  return digits;
});
const firebaseSessionSchema = z.object({
  idToken: z.string().min(1).max(8192),
});
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

export interface AuthRouteOptions {
  readonly config: AppConfig;
  readonly firebaseTokenVerifier: FirebaseTokenVerifier;
  readonly rateLimiter: OtpRateLimiter;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  options,
) => {
  app.post('/auth/firebase-session', async (request, reply) => {
    const parsed = firebaseSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid Firebase sign-in token' });
    }

    let identity;
    try {
      identity = await options.firebaseTokenVerifier.verifyIdToken(
        parsed.data.idToken,
      );
    } catch (error: unknown) {
      if (error instanceof FirebaseAdminConfigurationError) {
        request.log.error({ err: error }, 'Firebase Admin is not configured');
        return reply.code(503).send({ error: 'Phone sign-in is not configured' });
      }
      if (error instanceof FirebaseTokenInvalidError) {
        return reply.code(401).send({ error: 'Invalid or expired Firebase token' });
      }
      throw error;
    }

    if (identity.phoneNumber === undefined) {
      return reply.code(401).send({ error: 'Firebase account has no valid phone number' });
    }

    const parsedMobile = mobileSchema.safeParse(identity.phoneNumber);
    if (!parsedMobile.success) {
      return reply.code(401).send({ error: 'Firebase account has no valid phone number' });
    }
    const mobile = parsedMobile.data;

    if (
      !options.rateLimiter.consume([
        `firebase:mobile:${mobile}`,
        `firebase:ip:${request.ip}`,
      ])
    ) {
      return reply.code(429).send({ error: 'Too many sign-in attempts' });
    }

    const now = new Date();
    const session = await app.db.transaction(async (tx) => {
      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.mobile, mobile))
        .limit(1)
        .for('update');

      if (existingUser !== undefined && existingUser.deletedAt !== null) {
        return { status: 'deleted' as const };
      }
      if (existingUser !== undefined && !existingUser.isActive) {
        return { status: 'deleted' as const };
      }

      const isNewUser = existingUser === undefined;
      const [user] =
        existingUser === undefined
          ? await tx
              .insert(users)
              .values({
                mobile,
                avatarIndex: randomInt(0, 8),
              })
              .returning({ id: users.id })
          : [{ id: existingUser.id }];

      if (user === undefined) {
        throw new Error('Failed to create user');
      }

      const refreshToken = createRefreshToken();
      await tx.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashRefreshToken(
          refreshToken,
          options.config.JWT_REFRESH_SECRET,
        ),
        expiresAt: new Date(now.getTime() + refreshTtlMs),
      });

      return {
        status: 'valid' as const,
        userId: user.id,
        refreshToken,
        isNewUser,
      };
    });

    if (session.status !== 'valid') {
      return reply.code(401).send({ error: 'This account is unavailable' });
    }

    const accessToken = app.jwt.sign(
      { sub: session.userId, type: 'access' },
      { expiresIn: '15m' },
    );

    return reply.send({
      accessToken,
      refreshToken: session.refreshToken,
      isNewUser: session.isNewUser,
    });
  });

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid refresh token' });
    }

    const now = new Date();
    const oldTokenHash = hashRefreshToken(
      parsed.data.refreshToken,
      options.config.JWT_REFRESH_SECRET,
    );
    const rotated = await app.db.transaction(async (tx) => {
      const [storedToken] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, oldTokenHash))
        .limit(1)
        .for('update');

      if (
        storedToken === undefined ||
        storedToken.revokedAt !== null ||
        storedToken.expiresAt.getTime() <= now.getTime()
      ) {
        return undefined;
      }

      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, storedToken.userId), eq(users.isActive, true)))
        .limit(1);

      if (user === undefined) {
        return undefined;
      }

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.id, storedToken.id), isNull(refreshTokens.revokedAt)));

      const refreshToken = createRefreshToken();
      await tx.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashRefreshToken(
          refreshToken,
          options.config.JWT_REFRESH_SECRET,
        ),
        expiresAt: new Date(now.getTime() + refreshTtlMs),
      });
      return { userId: user.id, refreshToken };
    });

    if (rotated === undefined) {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }

    return reply.send({
      accessToken: app.jwt.sign(
        { sub: rotated.userId, type: 'access' },
        { expiresIn: '15m' },
      ),
      refreshToken: rotated.refreshToken,
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid refresh token' });
    }

    await app.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(
            refreshTokens.tokenHash,
            hashRefreshToken(parsed.data.refreshToken, options.config.JWT_REFRESH_SECRET),
          ),
          isNull(refreshTokens.revokedAt),
        ),
      );
    return reply.code(204).send();
  });
};
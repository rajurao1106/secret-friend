import { randomInt } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import {
  otpCodes,
  refreshTokens,
  users,
} from '../schema/index.js';
import { OtpRateLimiter } from '../services/otp-rate-limiter.js';
import {
  generateOtp,
  hashOtp,
  OTP_TTL_MS,
  verifyOtpChallenge,
} from '../services/otp.js';
import type { OtpProvider } from '../services/otp-provider.js';
import {
  createRefreshToken,
  hashRefreshToken,
} from '../utils/refresh-token.js';

const mobilePattern = /^(?:(?:\+91|91))?[6-9]\d{9}$/;
const mobileSchema = z.string().trim().regex(mobilePattern).transform((value) => {
  const digits = value.replace(/^\+?91/, '');
  return digits;
});
const sendOtpSchema = z.object({ mobile: mobileSchema });
const verifyOtpSchema = z.object({
  mobile: mobileSchema,
  code: z.string().regex(/^\d{6}$/),
});
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(256) });
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;

export interface AuthRouteOptions {
  readonly config: AppConfig;
  readonly otpProvider: OtpProvider;
  readonly rateLimiter: OtpRateLimiter;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  options,
) => {
  app.post('/auth/send-otp', async (request, reply) => {
    const parsed = sendOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid Indian mobile number' });
    }

    const { mobile } = parsed.data;
    if (
      !options.rateLimiter.consume([
        `otp:mobile:${mobile}`,
        `otp:ip:${request.ip}`,
      ])
    ) {
      return reply.code(429).send({ error: 'Too many OTP requests' });
    }

    const code = generateOtp();
    await app.db.delete(otpCodes).where(eq(otpCodes.mobile, mobile));
    const [challenge] = await app.db
      .insert(otpCodes)
      .values({
        mobile,
        codeHash: hashOtp(mobile, code, options.config.JWT_SECRET),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
      })
      .returning({ id: otpCodes.id });

    if (challenge === undefined) {
      throw new Error('Failed to create OTP challenge');
    }

    try {
      await options.otpProvider.sendOtp(mobile, code);
    } catch (error: unknown) {
      await app.db.delete(otpCodes).where(eq(otpCodes.id, challenge.id));
      throw error;
    }

    return reply.code(202).send({ message: 'OTP sent' });
  });

  app.post('/auth/verify-otp', async (request, reply) => {
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid verification request' });
    }

    const { mobile, code } = parsed.data;
    const now = new Date();
    const session = await app.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(otpCodes)
        .where(eq(otpCodes.mobile, mobile))
        .orderBy(desc(otpCodes.createdAt))
        .limit(1)
        .for('update');

      if (challenge === undefined) {
        return { status: 'invalid' as const };
      }

      const verification = verifyOtpChallenge(
        challenge,
        mobile,
        code,
        options.config.JWT_SECRET,
        now,
      );

      if (verification.status !== 'valid') {
        if (
          verification.status === 'invalid' ||
          verification.status === 'attempt_limit'
        ) {
          await tx
            .update(otpCodes)
            .set({ attempts: verification.attempts })
            .where(eq(otpCodes.id, challenge.id));
        }
        return { status: verification.status };
      }

      await tx.delete(otpCodes).where(eq(otpCodes.mobile, mobile));

      const [existingUser] = await tx
        .select()
        .from(users)
        .where(eq(users.mobile, mobile))
        .limit(1);

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
      return reply.code(session.status === 'attempt_limit' ? 429 : 401).send({
        error:
          session.status === 'attempt_limit'
            ? 'OTP attempt limit reached'
            : 'Invalid or expired OTP',
      });
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

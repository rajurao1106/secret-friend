import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/env.js';
import { getCorsOrigins } from '../utils/cors-origins.js';

async function securityPlugin(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  const allowedOrigins = getCorsOrigins(config);
  const configuredOrigins = config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.trim();

      const repeatedConfiguredOrigin = configuredOrigins.find(
        (candidate) => normalizedOrigin === `${candidate}${candidate}`,
      );
      if (repeatedConfiguredOrigin !== undefined) {
        callback(null, repeatedConfiguredOrigin);
        return;
      }

      const matchesAllowedOrigin = allowedOrigins.some((candidate) => {
        if (typeof candidate === 'string') {
          return normalizedOrigin === candidate;
        }
        return candidate.test(normalizedOrigin);
      });

      if (matchesAllowedOrigin) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['x-vercel-id', 'x-request-id'],
  });
  await app.register(helmet);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '15 minutes',
  });
}

export default fp(securityPlugin, { name: 'security' });

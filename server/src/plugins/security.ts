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
  await app.register(cors, {
    origin: getCorsOrigins(config),
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

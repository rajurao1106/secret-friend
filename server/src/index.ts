import Fastify from 'fastify';
import { buildApp } from './create-app.js';
import { env } from './config/env.js';

const app = Fastify({ logger: env.NODE_ENV !== 'test' });
buildApp(env, app);

try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error: unknown) {
  app.log.error({ err: error }, 'Failed to start server');
  await app.close();
  process.exitCode = 1;
}

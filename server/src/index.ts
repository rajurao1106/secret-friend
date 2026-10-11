import { buildApp } from './create-app.js';
import { env } from './config/env.js';

const app = buildApp(env);

try {
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (error: unknown) {
  app.log.error({ err: error }, 'Failed to start server');
  await app.close();
  process.exitCode = 1;
}

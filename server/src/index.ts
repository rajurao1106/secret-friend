import type { IncomingMessage, ServerResponse } from 'node:http';

let appPromise: Promise<any> | undefined;

async function getApp() {
  const [{ default: Fastify }, { buildApp }, { env }] = await Promise.all([
    import('fastify'),
    import('../src/create-app.js'),
    import('../src/config/env.js'),
  ]);
  const app = buildApp(env, Fastify({ logger: false }));
  await app.ready();
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    appPromise ??= getApp();
    const app = await appPromise;
    app.server.emit('request', req, res);
  } catch (error) {
    appPromise = undefined;
    console.error('Startup failed:', error);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Server failed to start. Check Vercel runtime logs.' }));
  }
}
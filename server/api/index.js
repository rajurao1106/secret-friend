// Vercel serverless entry point.
// Vercel does not run app.listen(), so we hand each request to Fastify's Node server.
import Fastify from 'fastify';

let appPromise;

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      // Imported lazily so a startup error (e.g. missing env var) is logged clearly.
      const { buildApp } = await import('../dist/create-app.js');
      const { env } = await import('../dist/config/env.js');
      const app = buildApp(env, Fastify({ logger: true, trustProxy: true }));
      await app.ready();
      return app;
    })();
    appPromise.catch(() => {
      appPromise = undefined; // allow retry on next request
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    app.server.emit('request', req, res);
  } catch (error) {
    console.error('Server failed to start:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server failed to start. Check Vercel runtime logs.' }));
  }
}
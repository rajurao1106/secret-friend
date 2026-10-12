// api/index.ts
import Fastify from 'fastify';
import { buildApp } from '../src/create-app.js';
import { env } from '../src/config/env.js';

const app = buildApp(env, Fastify({ logger: true }));

export default async function handler(req: any, res: any) {
  await app.ready();
  app.server.emit('request', req, res);
}
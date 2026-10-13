import Fastify from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp } from '../src/create-app.js';
import { env } from '../src/config/env.js';

const app = buildApp(env, Fastify({ logger: false }));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await app.ready();
  app.server.emit('request', req, res);
}
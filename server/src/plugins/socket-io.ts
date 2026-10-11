import { Server as SocketServer } from 'socket.io';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppConfig } from '../config/env.js';
import { users } from '../schema/users.js';
import { userRoomName } from '../sockets/user-room.js';
import { registerChatSocketHandlers } from '../sockets/chat.js';
import { getCorsOrigins } from '../utils/cors-origins.js';

async function socketIoPlugin(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  const sockets = new SocketServer(app.server, {
    cors: { origin: getCorsOrigins(config) },
    transports: ['websocket'],
  });
  app.decorate('sockets', sockets);

  sockets.use((socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string') {
      next(new Error('Unauthorized'));
      return;
    }

    try {
      const claims = app.jwt.verify<{ sub?: string; type?: string }>(token);
      if (typeof claims.sub !== 'string' || claims.type !== 'access') {
        next(new Error('Unauthorized'));
        return;
      }
      void app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, claims.sub), eq(users.isActive, true)))
        .limit(1)
        .then(([user]) => {
          next(user === undefined ? new Error('Unauthorized') : undefined);
        })
        .catch((error: unknown) => {
          app.log.error({ err: error }, 'Failed to verify socket user');
          next(new Error('Unauthorized'));
        });
    } catch (error: unknown) {
      app.log.info({ err: error }, 'Rejected socket connection with invalid credentials');
      next(new Error('Unauthorized'));
    }
  });

  sockets.on('connection', (socket) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string') {
      socket.disconnect(true);
      return;
    }
    const claims = app.jwt.verify<{ sub: string; type: 'access' }>(token);
    socket.data.userId = claims.sub;
    void socket.join(userRoomName(claims.sub));
  });
  registerChatSocketHandlers(app, sockets);

  app.addHook('preClose', async () => {
    if (!app.server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      sockets.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

export default fp(socketIoPlugin, { name: 'socket-io' });

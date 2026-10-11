import type { preHandlerHookHandler } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import type { AppDatabase } from '../db/client.js';
import type { NotificationService } from '../services/notification-service.js';
import type { MediaStorage } from '../services/media-storage.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
    sockets: SocketServer;
    notificationService: NotificationService;
    mediaStorage: MediaStorage;
    authenticate: preHandlerHookHandler;
  }
}

declare module 'socket.io' {
  interface SocketData {
    userId: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      type: 'access';
    };
    user: {
      sub: string;
      type: 'access';
    };
  }
}

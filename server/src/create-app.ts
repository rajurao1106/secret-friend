import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import authenticationPlugin from './plugins/authentication.js';
import securityPlugin from './plugins/security.js';
import socketIoPlugin from './plugins/socket-io.js';
import type { AppConfig } from './config/env.js';
import { createDatabase } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { discoverRoutes } from './routes/discover.js';
import { healthRoutes } from './routes/health.js';
import { FirebaseAdminTokenVerifier } from './services/firebase-auth.js';
import { meRoutes } from './routes/me.js';
import { profileRoutes } from './routes/profile.js';
import { revealRoutes } from './routes/reveals.js';
import { safetyRoutes } from './routes/safety.js';
import { NominatimGeocodingService } from './services/geocoding.js';
import { OtpRateLimiter } from './services/otp-rate-limiter.js';
import { NoopNotificationService } from './services/notification-service.js';
import { createMediaStorage } from './services/media-storage.js';
import { NoopModerationService } from './services/moderation.js';
import { mediaRoutes } from './routes/media.js';
import { KundaliMatchQueue } from './services/kundali-match-queue.js';
import { UnconfiguredKundaliService } from './services/kundali.js';
import { meetupRoutes } from './routes/meetup.js';

export function buildApp(
  config: AppConfig,
  app = Fastify({ logger: config.NODE_ENV !== 'test' }),
) {
  const database = createDatabase(config.DATABASE_URL);
  app.decorate('db', database.db);
  app.decorate('notificationService', new NoopNotificationService());
  const mediaStorage = createMediaStorage(config);
  app.decorate('mediaStorage', mediaStorage);

  app.register(securityPlugin, config);
  app.register(jwt, { secret: config.JWT_SECRET });
  app.register(authenticationPlugin);
  app.register(socketIoPlugin, config);
  app.register(healthRoutes);
  app.register(authRoutes, {
    config,
    firebaseTokenVerifier: new FirebaseAdminTokenVerifier(config),
    rateLimiter: new OtpRateLimiter(3, 10 * 60 * 1000),
  });
  app.register(meRoutes);
  app.register(profileRoutes, {
    geocoding: new NominatimGeocodingService(),
    storage: mediaStorage,
  });
  app.register(chatRoutes);
  app.register(meetupRoutes);
  app.register(discoverRoutes, {
    kundaliService: new UnconfiguredKundaliService(),
    queue: new KundaliMatchQueue(),
  });
  app.register(revealRoutes);
  app.register(safetyRoutes);
  app.register(mediaRoutes, {
    storage: mediaStorage,
    moderation: new NoopModerationService(),
  });

  app.addHook('onClose', async () => database.close());

  return app;
}

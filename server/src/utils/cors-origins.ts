import type { AppConfig } from '../config/env.js';

export function getCorsOrigins(config: AppConfig): Array<string | RegExp> {
  const origins: Array<string | RegExp> = [config.CORS_ORIGIN];
  if (config.NODE_ENV === 'development') {
    origins.push(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/);
  }
  return origins;
}

import type { AppConfig } from '../config/env.js';

// CORS_ORIGIN can hold one or many origins, comma-separated:
// CORS_ORIGIN=https://myapp.com,http://localhost:5000
export function getCorsOrigins(config: AppConfig): Array<string | RegExp> {
  const origins: Array<string | RegExp> = config.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter((origin) => origin.length > 0);

  if (config.NODE_ENV === 'development') {
    origins.push(/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/);
  }
  return origins;
}
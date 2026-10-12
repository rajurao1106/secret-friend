import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    // Serverless: keep connections minimal so the database is not exhausted.
    max: process.env.VERCEL === '1' ? 1 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

export type AppDatabase = ReturnType<typeof createDatabase>['db'];
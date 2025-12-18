import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const pool = new Pool({
  connectionString,
  max: 20,                      // Increased from 10 to handle 4+ concurrent players
  idleTimeoutMillis: 30000,     // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Wait up to 10s for connection
  statement_timeout: 15000,     // Reduced from 30s - kill slow queries faster
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;

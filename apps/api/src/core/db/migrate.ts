import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createDb } from './db.module';

/** Applies all pending SQL migrations from `apps/api/drizzle`. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(createDb(pool), { migrationsFolder: path.join(__dirname, '../../../drizzle') });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Use the real environment.
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => console.log('Migrations applied'))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

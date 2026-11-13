import { runMigrations } from '../src/core/db/migrate';
import './setup-env';

export default async function globalSetup(): Promise<void> {
  await runMigrations(process.env.DATABASE_URL as string);
}

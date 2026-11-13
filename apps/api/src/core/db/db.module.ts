import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { CONFIG, loadConfig, type Config } from '../config';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Repositories accept either, so the same query works inside or outside a transaction. */
export type Executor = Db | Tx;

export const DB = Symbol('DB');
const POOL = Symbol('POOL');

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: loadConfig },
    {
      provide: POOL,
      inject: [CONFIG],
      useFactory: (config: Config) => new Pool({ connectionString: config.DATABASE_URL, max: 10 }),
    },
    { provide: DB, inject: [POOL], useFactory: createDb },
  ],
  exports: [CONFIG, DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

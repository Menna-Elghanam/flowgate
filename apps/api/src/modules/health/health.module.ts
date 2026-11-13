import { Controller, Get, Inject, Module } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Public } from '../../core/auth/context';
import { DB, type Db } from '../../core/db/db.module';
import { AppError } from '../../core/errors';
import { REDIS } from '../../core/queue/queue.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await Promise.all([this.db.execute(sql`select 1`), this.redis.ping()]);
    } catch {
      throw new AppError(503, 'UNHEALTHY', 'Database or Redis is not reachable');
    }
    return { status: 'ok' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}

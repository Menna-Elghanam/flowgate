import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { CONFIG, type Config } from '../config';
import { Effects, EffectsRunner, type ChangeNotice, type EmailJob } from '../effects/effects';

export const REDIS = Symbol('REDIS');
export const EMAIL_QUEUE = Symbol('EMAIL_QUEUE');
export const SWEEP_QUEUE = Symbol('SWEEP_QUEUE');
export const QUEUE_NAMES = { email: 'email', sweep: 'deadline-sweep' } as const;
export const REALTIME_CHANNEL = 'flowgate:changes';

export function createRedis(url: string): Redis {
  // BullMQ requires `maxRetriesPerRequest: null` so blocking commands never time out.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/**
 * Publishes change notices through Redis instead of emitting to sockets directly, so the
 * worker process (escalations) and every API instance reach the same connected browsers.
 */
@Injectable()
export class QueueEffectsRunner extends EffectsRunner {
  private readonly logger = new Logger('Effects');

  constructor(
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue<EmailJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super();
  }

  async flush(effects: Effects): Promise<void> {
    // The transaction already committed; a delivery failure must not turn into an error
    // response for a change that did happen. Log it instead.
    try {
      await Promise.all([
        ...effects.emails.map((job) =>
          this.emailQueue.add(job.template, job, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          }),
        ),
        ...effects.changeNotices.map((notice: ChangeNotice) =>
          this.redis.publish(REALTIME_CHANNEL, JSON.stringify(notice)),
        ),
      ]);
    } catch (error) {
      this.logger.error(`Failed to deliver effects: ${String(error)}`);
    }
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [CONFIG], useFactory: (c: Config) => createRedis(c.REDIS_URL) },
    {
      provide: EMAIL_QUEUE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new Queue<EmailJob>(QUEUE_NAMES.email, { connection: redis }),
    },
    {
      provide: SWEEP_QUEUE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new Queue(QUEUE_NAMES.sweep, { connection: redis }),
    },
  ],
  exports: [REDIS, EMAIL_QUEUE, SWEEP_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @Inject(SWEEP_QUEUE) private readonly sweepQueue: Queue,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.emailQueue.close(), this.sweepQueue.close()]);
    await this.redis.quit();
  }
}

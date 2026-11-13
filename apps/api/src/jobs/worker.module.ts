import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import { CONFIG, type Config } from '../core/config';
import { DB, type Db } from '../core/db/db.module';
import { users } from '../core/db/schema';
import type { EmailJob } from '../core/effects/effects';
import { createRedis, QUEUE_NAMES, SWEEP_QUEUE } from '../core/queue/queue.module';
import { EngineModule } from '../engine/engine.module';
import { EngineService } from '../engine/engine.service';
import { renderEmail } from './templates';

@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('EmailWorker');
  private worker?: Worker<EmailJob>;
  private readonly transport: Transporter;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    this.transport = createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
  }

  onApplicationBootstrap(): void {
    this.worker = new Worker<EmailJob>(QUEUE_NAMES.email, (job) => this.send(job), {
      connection: createRedis(this.config.REDIS_URL),
      concurrency: 5,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.warn(
        `Email ${job?.name ?? ''} failed (attempt ${job?.attemptsMade ?? 0}): ${error.message}`,
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.transport.close();
  }

  private async send(job: Job<EmailJob>): Promise<void> {
    const { template, toUserId, toEmail, vars } = job.data;
    let to = toEmail;
    let name: string | undefined;
    if (toUserId) {
      const [user] = await this.db.select().from(users).where(eq(users.id, toUserId));
      if (!user) return; // the account was deleted; nothing to send
      to = user.email;
      name = user.name;
    }
    if (!to) throw new Error('Email job without a recipient');
    const email = renderEmail(template, vars, name);
    await this.transport.sendMail({ from: this.config.MAIL_FROM, to, ...email });
  }
}

/** Ticks the deadline sweep. BullMQ runs each tick once even with several workers. */
@Injectable()
export class SweepWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('DeadlineSweep');
  private worker?: Worker;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SWEEP_QUEUE) private readonly queue: Queue,
    private readonly engine: EngineService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'deadline-sweep',
      { every: this.config.SWEEP_INTERVAL_MS },
      { name: 'sweep', opts: { removeOnComplete: 100, removeOnFail: 100 } },
    );
    this.worker = new Worker(
      QUEUE_NAMES.sweep,
      async () => {
        const result = await this.engine.runDeadlineSweep();
        if (result.escalated || result.reminded) {
          this.logger.log(
            `Escalated ${result.escalated} task(s), sent ${result.reminded} reminder(s)`,
          );
        }
        return result;
      },
      { connection: createRedis(this.config.REDIS_URL) },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

@Module({
  imports: [EngineModule],
  providers: [EmailWorker, SweepWorker],
})
export class WorkerModule {}

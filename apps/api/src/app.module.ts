import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SessionGuard } from './core/auth/session.guard';
import { loadConfig } from './core/config';
import { DbModule } from './core/db/db.module';
import { EffectsModule } from './core/effects/effects.module';
import { AllExceptionsFilter } from './core/errors';
import { QueueEffectsRunner, QueueModule } from './core/queue/queue.module';
import { WorkerModule } from './jobs/worker.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { OrgsModule } from './modules/orgs/orgs.module';
import { RequestsModule } from './modules/requests/requests.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { RealtimeModule } from './realtime/realtime.gateway';

@Module({
  imports: [
    DbModule,
    QueueModule,
    EffectsModule.forRoot(QueueEffectsRunner),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    AuthModule,
    OrgsModule,
    WorkflowsModule,
    RequestsModule,
    AuditModule,
    DashboardModule,
    HealthModule,
    RealtimeModule,
    // In development the worker runs in the API process; in production it's its own process.
    ...(loadConfig().RUN_WORKER ? [WorkerModule] : []),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

/** What the standalone worker process needs: no HTTP, no controllers. */
@Module({
  imports: [DbModule, QueueModule, EffectsModule.forRoot(QueueEffectsRunner), WorkerModule],
})
export class WorkerAppModule {}
